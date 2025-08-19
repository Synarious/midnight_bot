const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: Events.MessageDelete,
    once: false,
    async execute(message) {
        // Ignore messages from bots
        if (message.author?.bot) return;

        const logChannelId = "798324364301959169";
        const logChannel = message.guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        const timestamp = Math.floor(Date.now() / 1000); // Discord timestamp
        const authorTag = message.author?.tag;
        const authorTitleArea = '🛠️ Message Deleted' || 'Unknown User';
        const userID = message.author?.id || 'Unknown';
        const channel = message.channel.id || 'Unknown Channel';

        let content;

        if (message.content) {
            // Start with the first 1024 characters
            content = message.content.substring(0, 1024);

            // If there's more, append additional chunks
            if (message.content.length > 1024) {
                const chunks = Math.ceil(message.content.length / 1024);
                for (let i = 1; i < chunks; i++) {
                    content += `\n(Content continued ${i}):\n` +
                        message.content.substring(i * 1024, (i + 1) * 1024);
                }
            }
        } else {
            content = '*(No text content)*';
        }

        const embed = new EmbedBuilder()
            .setColor(0x6379d3)
            .setAuthor({
                name: authorTitleArea,
                iconURL: message.author?.displayAvatarURL() || null
            })
            .setDescription([
                `<@${userID}> | ${authorTag} **In: **<#${channel}>`,
                `-# ----------------**[ Message Content ]**-------------------`,
                `${content}`,
                `-# ----------------------------------------------------------`,
                `-# UserID: ${message.author?.id || 'Unknown'} - <t:${timestamp}:R>`
            ].join('\n'));


        // Handle attachments (images, files, etc.)
        if (message.attachments.size > 0) {
            const attachments = Array.from(message.attachments.values());

            const firstAttachment = attachments[0];
            if (firstAttachment.contentType?.startsWith('image/')) {
                embed.setImage(firstAttachment.proxyURL);
            }

            const attachmentsList = attachments.map(a =>
                `[${a.name}](${a.url}) (${(a.size / 1024).toFixed(2)} KB)`
            ).join('\n');

            embed.addFields({ name: 'Attachments', value: attachmentsList });
        }

        // Optional button row (link to Discord status or related info)
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('API')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discordstatus.com/')
        );

        // Send the log embed with button
        await logChannel.send({ embeds: [embed], components: [buttonRow] });
    },
};
