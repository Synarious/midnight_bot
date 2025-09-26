const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../../data/database.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cban')
        .setDescription('Ban user + clean channel messages.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason')
                .setMaxLength(512)
        ),

    async execute(interaction) {
        const { guild, member, channel } = interaction;
        const userToBan = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const result = await pool.query('SELECT roles_admin, roles_mod, ch_actionLog FROM guild_settings WHERE guild_id = $1', [guild.id]);
        if (!result.rows[0]) {
            return interaction.reply({ content: 'Guild settings not found in the database.', ephemeral: true });
        }

    const settings = result.rows[0];
    const roles_admin = Array.isArray(settings.roles_admin) ? settings.roles_admin : 
              (settings.roles_admin ? JSON.parse(settings.roles_admin) : []);
    const roles_mod = Array.isArray(settings.roles_mod) ? settings.roles_mod :
             (settings.roles_mod ? JSON.parse(settings.roles_mod) : []);
    // Use DB-configured action log only
    const ch_actionLog = settings.ch_actionLog;

        const hasPermission = member.roles.cache.some(role =>
            roles_admin.includes(role.id) || roles_mod.includes(role.id)
        ) || member.permissions.has('ADMINISTRATOR');
        if (!hasPermission) {
            return interaction.reply({ content: 'You do not have permission to ban users.', ephemeral: true });
        }

        // Bot permission check
        const botMember = guild.members.me;
        if (!botMember?.permissions.has('BanMembers')) {
            return interaction.reply({ content: 'I do not have permission to ban members.', ephemeral: true });
        }

        // Delete messages in this channel from the user in the past 3 days (only if member still in guild)
        const userToBanMember = await guild.members.fetch(userToBan.id).catch(() => null);
        if (userToBanMember) {
            if (!userToBanMember.bannable) {
                return interaction.reply({ content: 'I cannot ban that user. They may have a higher role than me or I lack ban permissions.', ephemeral: true });
            }
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const now = Date.now();
                const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);

                const messagesToDelete = messages.filter(m =>
                    m.author.id === userToBan.id &&
                    m.createdTimestamp >= threeDaysAgo
                );

                for (const msg of messagesToDelete.values()) {
                    await msg.delete().catch(() => {});
                }

            } catch (err) {
                console.warn(`Could not delete messages from ${userToBan.tag} in ${channel.name}:`, err);
            }
        }

        // Ban the user
        try {
            await guild.members.ban(userToBan.id, { reason });

            // Public message in current channel
            await channel.send(`${userToBan.tag} has been **banned** by ${member.user.tag}`);

            // Log to action log (DB-configured only)
            if (!ch_actionLog) {
                console.error(`[ERROR] No action log configured for guild ${guild.id}. Cannot log cban for ${userToBan.id}`);
            } else {
                const actionLogChannel = await guild.channels.fetch(ch_actionLog).catch(() => null);
                if (!actionLogChannel) {
                    console.error(`[ERROR] Configured action log channel ${ch_actionLog} for guild ${guild.id} not found or inaccessible.`);
                    try {
                        if (interaction.deferred || interaction.replied) {
                            await interaction.followUp?.({ content: 'Ban recorded but failed to send to action log channel (configured channel missing).', ephemeral: true }).catch(() => {});
                        } else {
                            await interaction.reply?.({ content: 'Ban recorded but failed to send to action log channel (configured channel missing).', ephemeral: true }).catch(() => {});
                        }
                    } catch (_) {}
                } else {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🔨 User Banned')
                        .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`)
                        .setDescription([
                            `- **User**: <@${userToBan.id}> (${userToBan.tag || `<@${userToBan.id}>`})`,
                            `- **Banned By**: <@${member.user.id}> (${member.user.tag})`,
                            `- **Reason**: ${reason}`,
                            `- **Time**: <t:${Math.floor(Date.now() / 1000)}:R>`
                        ].join('\n'));
                    await actionLogChannel.send({ embeds: [embed] }).catch(err => {
                        console.error(`[ERROR] Failed to send cban log to channel ${ch_actionLog} for guild ${guild.id}:`, err);
                    });
                }
            }

            return interaction.reply({ content: `Banned ${userToBan.tag}${userToBanMember ? ' and removed recent messages in this channel' : ''}.`, ephemeral: true });

        } catch (error) {
            console.error(`Failed to ban ${userToBan.tag}:`, error);
            return interaction.reply({ content: 'There was an error trying to ban that user.', ephemeral: true });
        }
    }
};
