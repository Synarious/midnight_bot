const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../data/database.js');
const activityTracker = require('../../data/activityTracker.js');
const { getGuildSettings, addMutedUser, getActiveMute } = db;

/**
 * Parses a duration string (e.g., "1d 12h") into milliseconds.
 * @param {string} durationStr The string to parse.
 * @returns {number|null} Total milliseconds or null if invalid.
 */
function parseDuration(durationStr) {
    const regex = /(\d+)\s*(s|m|h|d|w)/gi; // s, m, h, d, w
    let totalMs = 0;
    let match;

    if (!durationStr || typeof durationStr !== 'string') return null;
    if (/^\d+$/.test(durationStr)) { // If it's just a number, assume minutes
        totalMs = parseInt(durationStr, 10) * 60 * 1000;
        return totalMs > 0 ? totalMs : null;
    }

    while ((match = regex.exec(durationStr)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        switch (unit) {
            case 's': totalMs += value * 1000; break;
            case 'm': totalMs += value * 60 * 1000; break;
            case 'h': totalMs += value * 3600 * 1000; break;
            case 'd': totalMs += value * 24 * 3600 * 1000; break;
            case 'w': totalMs += value * 7 * 24 * 3600 * 1000; break;
        }
    }
    return totalMs > 0 ? totalMs : null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a member for a specified duration.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to mute.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration of the mute (e.g., 10m, 1h, 7d). Max: 28 days.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the mute.')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const userOption = interaction.options.getUser('user');
        const target = userOption ? await interaction.guild.members.fetch(userOption.id).catch(() => null) : null;
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const executor = interaction.member;

        const settings = await getGuildSettings(interaction.guild.id);
        if (!settings || !settings.mute_roleid) {
            return interaction.editReply('The mute system is not configured for this server. Please set a mute role.');
        }
        
        const muteRole = await interaction.guild.roles.fetch(settings.mute_roleid).catch(() => null);
        if (!muteRole) {
            return interaction.editReply('The configured mute role could not be found. Please reconfigure it.');
        }

        // --- Permission & Sanity Checks ---
        if (!target) {
            return interaction.editReply("Could not find that user in the server.");
        }
        if (target.id === executor.id) {
            return interaction.editReply("You cannot mute yourself.");
        }
        if (target.id === interaction.client.user.id) {
            return interaction.editReply("You cannot mute me.");
        }
        if (target.roles.highest.position >= executor.roles.highest.position && interaction.guild.ownerId !== executor.id) {
             return interaction.editReply("You cannot mute someone with an equal or higher role than you.");
        }
        if (!muteRole.editable) {
            return interaction.editReply("I cannot assign the mute role. Please check my role hierarchy.");
        }

        const isAlreadyMuted = await getActiveMute(interaction.guild.id, target.id);
        if (isAlreadyMuted) {
            return interaction.editReply(`${target.user.tag} is already muted.`);
        }

        // Double-check: verify user doesn't already have mute role
        if (target.roles.cache.has(settings.mute_roleid)) {
            return interaction.editReply(`${target.user.tag} already has the mute role but no active mute record. Please contact an administrator.`);
        }

        const immuneUsers = JSON.parse(settings.mute_immuneuserids || '[]');
        
        const hasAdminPerm = executor.permissions.has(PermissionFlagsBits.Administrator);
        const hasPermission = hasAdminPerm || await db.hasPermissionLevel(interaction.guild.id, executor.id, 'helper', executor.roles.cache);
        
        if (!hasPermission) {
            return interaction.editReply("You do not have permission to use this command. Requires helper level or higher.");
        }

        // Get permission levels for additional checks
        const executorLevel = await db.getUserPermissionLevel(interaction.guild.id, executor.id, executor.roles.cache);
        const targetLevel = await db.getUserPermissionLevel(interaction.guild.id, target.id, target.roles.cache);
        
        // Prevent lower level users from muting higher level users
        const levelHierarchy = ['helper', 'jr_mod', 'mod', 'admin', 'super_admin'];
        const executorIndex = levelHierarchy.indexOf(executorLevel);
        const targetIndex = levelHierarchy.indexOf(targetLevel);
        
        if (targetIndex >= executorIndex && targetIndex !== -1 && !hasAdminPerm) {
            return interaction.editReply("You cannot mute someone with an equal or higher permission level.");
        }
        if (immuneUsers.includes(target.id)) {
            return interaction.editReply("This user is immune from mutes.");
        }


        // --- Duration Parsing ---
        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            return interaction.editReply("Invalid duration format. Use units like 'm', 'h', 'd', 'w'. Example: `7d`.");
        }
        
        const maxDuration = 28 * 24 * 60 * 60 * 1000; // 28 days
        if (durationMs > maxDuration) {
             return interaction.editReply("The maximum mute duration is 28 days.");
        }

        const expires = (Date.now() + durationMs).toString();

        // --- Mute Logic ---
        const originalRoles = target.roles.cache
            .filter(role => role.id !== interaction.guild.id) // Exclude @everyone
            .map(role => role.id);
        
        try {
            // Remove all roles except @everyone and add mute role
            await target.roles.set([muteRole.id]);

            await addMutedUser({
                guildId: interaction.guild.id,
                userId: target.id,
                reason: reason,
                roles: originalRoles,
                actionedBy: executor.id,
                length: durationStr,
                expires: expires,
            });

            // Track moderation action for dashboard
            await activityTracker.logModAction(interaction.guild.id, 'mute', {
                targetUserId: target.id,
                targetUsername: target.user.tag,
                moderatorId: executor.id,
                moderatorUsername: executor.user.tag,
                reason: reason,
                durationMinutes: Math.floor(durationMs / 60000)
            });

            // --- Confirmation ---
            const embed = new EmbedBuilder()
                .setColor(0xffa500)
                .setTitle("Member Muted")
                .addFields(
                    { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
                    { name: 'Moderator', value: `${executor.user.tag} (${executor.id})`, inline: true },
                    { name: 'Duration', value: durationStr, inline: true },
                    { name: 'Expires', value: `<t:${Math.floor(parseInt(expires) / 1000)}:R>`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });

            try {
                await target.send(`You have been muted in **${interaction.guild.name}** for **${durationStr}**.\nReason: ${reason}`);
            } catch (dmError) {
                console.log(`[MUTE] Could not DM user ${target.id} about their mute.`);
            }

        } catch (error) {
            console.error('[❌ MUTE COMMAND] Error executing mute:', error);
            return interaction.editReply("An error occurred while trying to mute this user. I may be missing permissions.");
        }
    },


  // Rate limit: 5 seconds (moderation action)
  rateLimit: 5000,
};