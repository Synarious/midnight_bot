const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../data/database.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unbans a user by ID or user mention (supports users who have left).')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to unban (if resolvable)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('User ID, username#discriminator, or full tag (use when user is not resolvable)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unban')
                .setMaxLength(512)
        ),

        async execute(interaction, args) {
            const { guild, member } = interaction;

        // Get settings
        const settings = await db.getGuildSettings(guild.id);
        if (!settings) {
            return interaction.reply({ content: 'Guild settings not found. Please run the setup command.', ephemeral: true });
        }

        const hasAdminPerm = member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasPermission = hasAdminPerm || await db.hasPermissionLevel(guild.id, member.id, 'admin', member.roles.cache);

        if (!hasPermission) {
            return interaction.reply({ content: 'You do not have permission to unban users. Requires admin level or higher.', ephemeral: true });
        }

            // Resolve target — support both real Interaction.options and the pseudo adapter's args array
            const opts = interaction.options || {};
            const hasGetUser = typeof opts.getUser === 'function';
            const hasGetString = typeof opts.getString === 'function';

            const userOption = hasGetUser ? opts.getUser('user') : null;
            const userIdOption = hasGetString ? opts.getString('user_id') : null;
            const reasonFromOption = hasGetString ? opts.getString('reason') : null;

            // For prefix usage, args will be an array (adapter passes it when execute has >1 params)
            const argsArr = Array.isArray(args) ? args : [];

            if (!userOption && !userIdOption && argsArr.length === 0) {
                return interaction.reply({ content: 'You must provide a user (or user ID).', ephemeral: true });
            }

            let userId = null;
            if (userOption) {
                userId = userOption.id;
            } else if (userIdOption && /^\d+$/.test(userIdOption)) {
                userId = userIdOption;
            } else if (argsArr.length > 0) {
                // Prefix form: first arg may be ID or username#discriminator
                const first = argsArr[0];
                if (/^\d+$/.test(first)) {
                    userId = first;
                } else {
                    // we'll search bans by tag/username using the provided first argument
                    // keep the non-ID string for later lookup
                    // store in userIdOptionLocal for ban-list search
                    var userIdOptionLocal = first;
                }
            }

            const reason = reasonFromOption || (argsArr.length > 1 ? argsArr.slice(1).join(' ') : 'No reason provided.');

        try {
                    // If we don't have a numeric ID yet, try to find by tag in ban list
                    if (!userId) {
                        const searchValue = userIdOption || (typeof userIdOptionLocal !== 'undefined' ? userIdOptionLocal : null);
                        if (!searchValue) {
                            return interaction.reply({ content: 'User not found in ban list. Provide a valid ID or exact username#discriminator.', ephemeral: true });
                        }
                        const bans = await guild.bans.fetch();
                        const target = bans.find(b => {
                            const tag = `${b.user.username}#${b.user.discriminator}`;
                            return tag === searchValue || b.user.username === searchValue;
                        });
                        if (!target) {
                            return interaction.reply({ content: 'User not found in ban list. Provide a valid ID or exact username#discriminator.', ephemeral: true });
                        }
                        userId = target.user.id;
                    }

            await interaction.deferReply({ ephemeral: true });

            await guild.members.unban(userId, reason);

            await interaction.editReply({ content: `Successfully unbanned <@${userId}>.` });

                    // Logging: require guild-configured action log channel
                    const logChannelId = settings.ch_actionlog ?? settings.ch_actionLog;
                    if (!logChannelId) {
                        console.error(`[ERROR] No action log configured for guild ${guild.id}. Cannot log unban for ${userId}`);
                    } else {
                        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                        if (!logChannel) {
                            console.error(`[ERROR] Configured action log channel ${logChannelId} for guild ${guild.id} not found or inaccessible.`);
                            try {
                                if (interaction.deferred || interaction.replied) {
                                    await interaction.followUp?.({ content: 'Unban recorded but failed to send to action log channel (configured channel missing).', ephemeral: true }).catch(() => {});
                                } else {
                                    await interaction.reply?.({ content: 'Unban recorded but failed to send to action log channel (configured channel missing).', ephemeral: true }).catch(() => {});
                                }
                            } catch (_) {}
                        } else {
                            const embed = new EmbedBuilder()
                                .setTitle('User Unbanned')
                                .setColor('#00FF00')
                                .addFields(
                                    { name: 'User', value: `<@${userId}> (${userId})`, inline: false },
                                    { name: 'Moderator', value: `${member.user.tag} (${member.id})`, inline: false },
                                    { name: 'Reason', value: reason, inline: false }
                                )
                                .setTimestamp();

                            await logChannel.send({ embeds: [embed] }).catch(err => {
                                console.error(`[ERROR] Failed to send unban log to channel ${logChannelId} for guild ${guild.id}:`, err);
                            });
                        }
                    }

        } catch (error) {
            console.error(`Failed to unban ${userId || userIdOption}:`, error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'An unexpected error occurred while unbanning. The ID may be invalid or I may lack permissions.' }).catch(() => {});
            } else {
                await interaction.reply({ content: 'An unexpected error occurred while unbanning. The ID may be invalid or I may lack permissions.', ephemeral: true }).catch(() => {});
            }
        }
    }
};