const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const database = require('../../data/database');

let schemaEnsured = false;

async function ensureDeletedMessagesSchema() {
    if (schemaEnsured) return;
    schemaEnsured = true;

    try {
        await database.query(
            `
            CREATE TABLE IF NOT EXISTS deleted_messages (
                id BIGSERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                content TEXT,
                deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `,
            [],
            { context: 'ensureDeletedMessagesSchema' }
        );

        await database.query(
            'CREATE INDEX IF NOT EXISTS idx_deleted_messages_guild_user_time ON deleted_messages (guild_id, user_id, deleted_at DESC)',
            [],
            { context: 'ensureDeletedMessagesSchema:index' }
        );
    } catch (error) {
        // Fail-open: logging should not crash the bot
        console.error('[sl_messageDelete] Failed to ensure deleted_messages schema:', error);
    }
}

module.exports = {
    name: Events.MessageDelete,
    once: false,
    async execute(message) {
        // Ignore messages from bots
        if (message.author?.bot) return;

        if (!message.guild) return;

        await ensureDeletedMessagesSchema();

        // Persist deleted content for /deleted lookups (best-effort)
        if (message.author?.id) {
            try {
                await database.query(
                    `
                    INSERT INTO deleted_messages (guild_id, user_id, content, deleted_at)
                    VALUES ($1, $2, $3, NOW())
                `,
                    [message.guild.id, message.author.id, message.content || null],
                    { rateKey: message.guild.id, context: 'logDeletedMessage' }
                );
            } catch (error) {
                console.error('[sl_messageDelete] Failed to store deleted message:', error);
            }
        }

        // Send log embed only if configured
        let logChannelId = null;
        try {
            const settings = await database.getGuildSettings(message.guild.id);
            logChannelId = database.resolveEnabledLogChannelId(settings, 'ch_deletedmessages');
        } catch {
            // ignore
        }

        if (!logChannelId) return;

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
