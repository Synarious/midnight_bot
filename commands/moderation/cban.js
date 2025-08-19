const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { db } = require('../../data/database.js');

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

        const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
        if (!settings) {
            return interaction.reply({ content: 'Guild settings not found in the database.', ephemeral: true });
        }

        const { roles_admin, roles_mod, ch_actionLog } = settings;

        const hasPermission = member.roles.cache.some(role =>
            roles_admin.includes(role.id) || roles_mod.includes(role.id)
        );
        if (!hasPermission) {
            return interaction.reply({ content: 'You do not have permission to ban users.', ephemeral: true });
        }

        // Delete messages in this channel from the user in the past 3 days (only if member still in guild)
        const userToBanMember = await guild.members.fetch(userToBan.id).catch(() => null);
        if (userToBanMember) {
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

            // Log to action log
            const actionLogChannel = guild.channels.cache.get(ch_actionLog);
            if (actionLogChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🔨 User Banned')
                    .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`)
                    .setDescription([
                        `- **User**: <@${userToBan.id}> (${userToBan.tag})`,
                        `- **Banned By**: <@${member.user.id}> (${member.user.tag})`,
                        `- **Reason**: ${reason}`,
                        `- **Time**: <t:${Math.floor(Date.now() / 1000)}:R>`
                    ].join('\n'));
                await actionLogChannel.send({ embeds: [embed] });
            }

            return interaction.reply({ content: `Successfully banned ${userToBan.tag}${userToBanMember ? ' and removed recent messages in this channel' : ''}.`, ephemeral: true });

        } catch (error) {
            console.error(`Failed to ban ${userToBan.tag}:`, error);
            return interaction.reply({ content: 'There was an error trying to ban that user.', ephemeral: true });
        }
    }
};
