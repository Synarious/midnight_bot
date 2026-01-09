const { EmbedBuilder } = require('discord.js');
const { getNoDangerEditsSettings } = require('../data/automodSettings');

// Default regex pattern (fallback)
const DEFAULT_FORBIDDEN_REGEX = /\b(child|children|kid|kids|young|babies|baby|age|old|years|school|elementary|daycare)\b/i;

module.exports = {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage) {
        // Ignore bots and messages with no content change
        const oldContent = (oldMessage.content || '');
        const newContent = (newMessage.content || '');
        if (!newMessage.guild || newMessage.author.bot || oldContent === newContent) {
            return;
        }

        try {
            // Get guild-specific settings from database
            const settings = await getNoDangerEditsSettings(newMessage.guild.id);
            
            // If no settings exist or feature is disabled, skip
            if (!settings || !settings.enabled) return;

            // Parse ignored channels
            const ignoredChannels = parseJsonArray(settings.ignored_channels);
            if (ignoredChannels.includes(newMessage.channel.id)) return;

            // Parse ignored roles
            const ignoredRoles = parseJsonArray(settings.ignored_roles);

            // Ignore users who have any of the bypass roles
            const member = await newMessage.guild.members.fetch(newMessage.author.id).catch(() => null);
            if (member && ignoredRoles.length > 0 && member.roles.cache.some(role => ignoredRoles.includes(role.id))) {
                return;
            }

            // Build regex from database settings
            const forbiddenWordsRegex = settings.forbidden_words_regex 
                ? new RegExp(settings.forbidden_words_regex, 'i')
                : DEFAULT_FORBIDDEN_REGEX;

            // Only act when the new edited message contains one of the monitored words
            if (!forbiddenWordsRegex.test(newContent)) {
                return;
            }

            // Delete the edited message
            try {
                await newMessage.delete();
            } catch (error) {
                console.error('Failed to delete edited message:', error);
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
            const logChannelId = settings.log_channel_id;
            if (!logChannelId) return;

            const logChannel = await newMessage.client.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) {
                return console.error(`Could not find log channel with ID ${logChannelId}`);
            }

            const user = newMessage.author;
            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL() })
                .setDescription(`**Message edited in ${newMessage.channel}** [Jump to Context](${newMessage.url})`)
                .addFields(
                    { name: 'Old Message', value: `\`\`\`${oldMessage.content.substring(0, 1020)}\`\`\`` },
                    { name: 'New Message', value: `\`\`\`${newMessage.content.substring(0, 1020)}\`\`\`` }
                )
                .setTimestamp()
                .setFooter({ text: 'Message Edit Blocked' });

            // Include ping if configured
            const pingRoleId = settings.ping_role_id;
            const alertContent = pingRoleId 
                ? `⚠️ **Potential Child Safety Concern.** Ping for <@&${pingRoleId}>`
                : `⚠️ **Potential Child Safety Concern.**`;

            try {
                await logChannel.send({ content: alertContent, embeds: [embed] });
            } catch (error) {
                console.error('Failed to send log message for edited message:', error);
            }
        } catch (error) {
            console.error('[noDangerEdits] Error processing message edit:', error);
        }
    },
};

function parseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
