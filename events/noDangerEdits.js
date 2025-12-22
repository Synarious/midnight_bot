const { EmbedBuilder } = require('discord.js');

const LOG_CHANNEL_ID = '1431690606350041098';
const PING_ROLE_ID = '1421008653200261222';
const FORBIDDEN_WORDS_REGEX = /\b(child|children|kid|kids|young|babies|baby|age|old|years|school|elementary|daycare)\b/i;
// Channels to ignore (add channel IDs here to exempt them from this check)
const IGNORED_CHANNELS = ['1349213872854401044'];
// Roles to ignore (add role IDs here to exempt members from this check)
const IGNORED_ROLES = ['1346009162823241749'];
// Guilds to enable this feature in (empty array means all guilds)
const ALLOWED_GUILD_IDS = ['1346007513237295144'];

module.exports = {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage) {
        // Ignore if not in an allowed guild
        if (ALLOWED_GUILD_IDS.length > 0 && !ALLOWED_GUILD_IDS.includes(newMessage.guild?.id)) {
            return;
        }

        // Ignore bots and messages with no content change
        const oldContent = (oldMessage.content || '');
        const newContent = (newMessage.content || '');
        if (newMessage.author.bot || oldContent === newContent) {
            return;
        }

        // Ignore configured channels
        if (IGNORED_CHANNELS.includes(newMessage.channel.id)) return;

        // Ignore users who have any of the bypass roles
        const member = await newMessage.guild.members.fetch(newMessage.author.id).catch(() => null);
        if (member && member.roles.cache.some(role => IGNORED_ROLES.includes(role.id))) return;

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
