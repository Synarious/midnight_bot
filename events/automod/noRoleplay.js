const { Events } = require('discord.js');
const { getNoRoleplaySettings } = require('../../data/automodSettings');

// Default settings (used as fallback)
const DEFAULT_ROMANTIC_KEYWORDS = /\b(cuddle|hug|kiss|nuzzle|wiggle|snuggle|purr|lick|blush)s?\b/i;

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        try {
            // Get guild-specific settings from database
            const settings = await getNoRoleplaySettings(message.guild.id);
            
            // If no settings exist or feature is disabled, skip
            if (!settings || !settings.enabled) return;

            // Parse whitelisted channels
            const whitelistedChannels = parseJsonArray(settings.whitelisted_channels);
            
            // Only run filter in whitelisted channels (if any are configured)
            if (whitelistedChannels.length > 0 && !whitelistedChannels.includes(message.channel.id)) {
                return;
            }

            // Parse ignored roles
            const ignoredRoles = parseJsonArray(settings.ignored_roles);

            // Ignore users with bypass roles
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member && ignoredRoles.length > 0 && member.roles.cache.some(role => ignoredRoles.includes(role.id))) {
                return;
            }

            const content = message.content;

            // Build regex from database settings
            const romanticKeywords = settings.romantic_keywords 
                ? new RegExp(`\\b(${settings.romantic_keywords})s?\\b`, 'i')
                : DEFAULT_ROMANTIC_KEYWORDS;

            // Check for *RP-style italics*
            const italicMatches = [...content.matchAll(/\*(?!\*)(.+?)\*(?!\*)/g)];
            for (const match of italicMatches) {
                const italicRaw = match[1] || '';
                const italic = italicRaw.replace(/^\*+|\*+$/g, '').trim();

                // Normalize repeated letters
                const normalizedItalic = italic.replace(/(.)\1{2,}/ig, '$1$1');
                if (romanticKeywords.test(normalizedItalic)) {
                    return warnAndDelete(message, `*${italic}*`);
                }
            }
        } catch (error) {
            console.error('[noRoleplay] Error checking message:', error);
        }
    }
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

async function warnAndDelete(message, matchedPhrase) {
    try {
        await message.delete();

        // Send private warning via DM instead of public channel message
        await message.author.send({
            content: `⚠️ Your message in **${message.guild.name}** (#${message.channel.name}) was removed for roleplay content.\n\nKeep roleplay to your DMs, follow server rules and help keep topics inclusive for everyone!\n\nMatched phrase: ${matchedPhrase}`
        }).catch(() => {
            // If DM fails, send a brief ephemeral-style message that auto-deletes quickly
            message.channel.send({
                content: `⚠️ <@${message.author.id}> Check your DMs for automod moderation details.`,
                allowedMentions: { users: [message.author.id] }
            }).then(warning => {
                setTimeout(() => {
                    warning.delete().catch(() => {});
                }, 3000);
            }).catch(() => {});
        });

    } catch (err) {
        console.error('Failed to delete or warn:', err);
    }
}
