const { EmbedBuilder } = require('discord.js');

const LOG_CHANNEL_ID = '1431690606350041098';
const PING_ROLE_ID = '1421008653200261222';
const FORBIDDEN_WORDS_REGEX = /\b(child|children|kid|kids|young|babies|baby|age|old|years|school|elementary|daycare)\b/i;

module.exports = {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage) {
        // Ignore bots and messages with no content change
        const oldContent = (oldMessage.content || '');
        const newContent = (newMessage.content || '');
        if (newMessage.author.bot || oldContent === newContent) {
            return;
        }

        // Only act when the new edited message contains one of the monitored words
        if (!FORBIDDEN_WORDS_REGEX.test(newContent)) {
            return; // nothing to do if edit doesn't include the targeted words
        }

        // Delete the edited message
        try {
            await newMessage.delete();
        } catch (error) {
            console.error('Failed to delete edited message:', error);
            // Proceed with logging even if deletion fails
        }

        // Send a temporary warning message
        try {
            const warningMsg = await newMessage.channel.send('Editing messages is temporarily disabled to protect users.');
            setTimeout(() => {
                warningMsg.delete().catch(err => console.error('Failed to delete warning message:', err));
            }, 10000);
        } catch (error) {
            console.error('Failed to send or delete warning message:', error);
        }

        // Log the edited message
        const logChannel = await newMessage.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (!logChannel) {
            return console.error(`Could not find log channel with ID ${LOG_CHANNEL_ID}`);
        }

        const user = newMessage.author;
        const embed = new EmbedBuilder()
            .setColor('#FFA500') // Orange
            .setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL() })
            .setDescription(`**Message edited in ${newMessage.channel}** [Jump to Context](${newMessage.url})`)
            .addFields(
                { name: 'Old Message', value: `\`\`\`${oldMessage.content.substring(0, 1020)}\`\`\`` },
                { name: 'New Message', value: `\`\`\`${newMessage.content.substring(0, 1020)}\`\`\`` }
            )
            .setTimestamp()
            .setFooter({ text: 'Message Edit Blocked' });

        // We only reach here when the new content matched, so always include the ping
        const alertContent = `⚠️ **Potential Child Safety Concern.** Ping for <@&${PING_ROLE_ID}>`;

        try {
            await logChannel.send({ content: alertContent, embeds: [embed] });
        } catch (error) {
            console.error('Failed to send log message for edited message:', error);
        }
    },
};
