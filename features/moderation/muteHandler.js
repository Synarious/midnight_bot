const { getActiveMute, getExpiredMutes, deactivateMute, getAllActiveMutes } = require('../../data/database.js');
const memberCache = require('../../utils/MemberCacheManager.js');

const CHECK_INTERVAL = 30 * 1000; // Check for expired mutes every 30 seconds
const FAILSAFE_INTERVAL = 5 * 60 * 1000; // Failsafe check every 5 minutes

/**
 * The main entry point to initialize the mute handling timers.
 * @param {import('discord.js').Client} client The Discord client instance.
 */

/**
 * @typedef {Object} Mute
 * @property {string} mute_id
 * @property {string} mute_roleid
 * @property {string} user_id
 * @property {string} guild_id
 * @property {string} roles - JSON stringified array of role IDs
 * @property {number} expires_at - Timestamp
 */

function initialize(client) {
    console.log('[MuteHandler] Initializing...');
    
    // Start the timer to check for expired mutes and unmute users.
    setInterval(() => checkExpiredMutes(client), CHECK_INTERVAL);
    
    // Start the timer for the failsafe mechanism.
    setInterval(() => checkActiveMutesFailsafe(client), FAILSAFE_INTERVAL);
    
    console.log('[MuteHandler] Timers for expired mutes and failsafe checks have been started.');
}

/**
 * Checks for and handles expired mutes.
 * @param {import('discord.js').Client} client
 */
async function checkExpiredMutes(client) {
    try {
        const expiredMutes = await getExpiredMutes();
        if (expiredMutes.length === 0) return;

        console.log(`[MuteHandler] Found ${expiredMutes.length} expired mutes to process.`);

        for (const mute of expiredMutes) {
            const guild = await client.guilds.fetch(mute.guild_id).catch(() => null);
            if (!guild) {
                // Bot is no longer in the guild, deactivate the mute to prevent re-checking
                await deactivateMute(mute.mute_id);
                continue;
            }
            
            const member = await guild.members.fetch(mute.user_id).catch(() => null);
            if (!member) {
                // User is no longer in the guild, deactivate mute
                await deactivateMute(mute.mute_id);
                continue;
            }

            console.log(`[MuteHandler] Unmuting ${member.user.tag} in ${guild.name}.`);
            await unmuteUser(member, mute);
        }
    } catch (error) {
        console.error('[❌ MuteHandler] Error in checkExpiredMutes:', error);
    }
}

/**
 * Failsafe: Periodically checks all active mutes to ensure they are correctly applied.
 * This handles cases where a mute role was manually removed or the bot restarted.
 * @param {import('discord.js').Client} client
 */
async function checkActiveMutesFailsafe(client) {
    try {
        const allActiveMutes = await getAllActiveMutes(client);
        if (allActiveMutes.length === 0) return;

        for (const mute of allActiveMutes) {
            const guild = client.guilds.cache.get(mute.guild_id);
            if (!guild) continue;

            const settings = await require('../../data/database.js').getGuildSettings(guild.id);
            if (!settings || !settings.mute_roleid) continue;

            // Try cache first, then fetch from API as fallback
            let member = guild.members.cache.get(mute.user_id);
            if (!member) {
                member = await guild.members.fetch(mute.user_id).catch(() => null);
            }

            if (member && !member.roles.cache.has(settings.mute_roleid)) {
                console.log(`[MuteHandler-Failsafe] Re-applying mute to ${member.user.tag} in ${guild.name}.`);
                // Use .set() to ensure only the mute role is applied.
                await member.roles.set([settings.mute_roleid]).catch(err => {
                    console.error(`[❌ MuteHandler-Failsafe] Failed to re-apply mute for ${member.id}:`, err);
                });
            }
        }
    } catch (error) {
        console.error('[❌ MuteHandler] Error in failsafe check:', error);
    }
}


/**
 * Handles a member joining the guild to check if they should be muted.
 * @param {import('discord.js').GuildMember} member
 */
async function handleMemberJoin(member) {
    try {
        const activeMute = await getActiveMute(member.guild.id, member.id);
        if (activeMute) {
            const settings = await require('../../data/database.js').getGuildSettings(member.guild.id);
            if (!settings || !settings.mute_roleid) return;

            const muteRole = member.guild.roles.cache.get(settings.mute_roleid);
            if (muteRole) {
                console.log(`[MuteHandler] Re-applying mute to returning member ${member.user.tag}.`);
                await member.roles.add(muteRole).catch(err => {
                    console.error(`[❌ MuteHandler] Failed to re-apply mute on join for ${member.id}:`, err);
                    return; // Exit early if role add fails
                });

                // Log to action log channel
                await logRemute(member, activeMute, settings);
            }
        }
    } catch (error) {
        console.error('[❌ MuteHandler] Error in handleMemberJoin:', error);
    }
}

/**
 * Unmutes a user by restoring their original roles.
 * @param {import('discord.js').GuildMember} member
 * @param {object} muteRecord The mute record from the database.
 */
async function unmuteUser(member, muteRecord) {
    try {
        const originalRoles = JSON.parse(muteRecord.roles);
        // Filter out roles that may have been deleted since the mute was applied.
        const rolesToRestore = originalRoles.filter(roleId => member.guild.roles.cache.has(roleId));

        await member.roles.set(rolesToRestore);
        await deactivateMute(muteRecord.mute_id);
        
        console.log(`[MuteHandler] Successfully unmuted ${member.user.tag}.`);

        try {
            await member.send(`Your mute in **${member.guild.name}** has expired. You have been unmuted.`);
        } catch (dmError) {
             console.log(`[MuteHandler] Could not DM user ${member.id} about their unmute.`);
        }
    } catch (error) {
        console.error(`[❌ MuteHandler] Failed to unmute user ${member.id}:`, error);
        // If the unmute fails (e.g., permissions), we don't deactivate the record,
        // so the system will try again on the next interval.
    }
}

/**
 * Logs a remute action to the guild's action log channel.
 * @param {import('discord.js').GuildMember} member
 * @param {object} muteRecord The active mute record from the database
 * @param {object} settings Guild settings containing channel IDs
 */
async function logRemute(member, muteRecord, settings) {
    try {
        const { EmbedBuilder } = require('discord.js');
        
        // Use guild-specific action log from DB
        const logChannelId = settings.ch_actionlog ?? settings.ch_actionLog;
        if (!logChannelId) {
            console.log(`[MuteHandler] No action log configured for guild ${member.guild.id}. Cannot log remute for ${member.id}`);
            return;
        }

        const logChannel = await member.guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            console.error(`[MuteHandler] Configured action log channel ${logChannelId} for guild ${member.guild.id} not found or inaccessible.`);
            return;
        }

        // Handle both 'expires' (TEXT) and 'expires_at' (TIMESTAMPTZ) fields
        const expiresValue = muteRecord.expires_at || muteRecord.expires;
        const expiresTimestamp = expiresValue ? Math.floor(parseInt(expiresValue) / 1000) : null;
        
        const embed = new EmbedBuilder()
            .setTitle('Member Re-Muted (Rejoin)')
            .setColor(0xFFA500) // Orange
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                { name: 'Original Moderator', value: `<@${muteRecord.actioned_by}>`, inline: true },
                { name: 'Duration', value: muteRecord.length || 'Unknown', inline: true },
                { name: 'Expires', value: expiresTimestamp ? `<t:${expiresTimestamp}:R>` : 'Unknown', inline: true },
                { name: 'Reason', value: muteRecord.reason || 'No reason provided.', inline: false },
                { name: 'Note', value: '⚠️ User rejoined the server with an active mute and was automatically re-muted.', inline: false }
            )
            .setTimestamp();

        await logChannel.send({ embeds: [embed] }).catch(err => {
            console.error(`[MuteHandler] Failed to send remute log to channel ${logChannelId} for guild ${member.guild.id}:`, err);
        });

    } catch (error) {
        console.error('[❌ MuteHandler] Error in logRemute:', error);
    }
}

module.exports = {
    initialize,
    handleMemberJoin,
};
