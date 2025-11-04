const { Events } = require('discord.js');

// ✅ RP filter only runs in these channels
const WHITELISTED_CHANNELS = ['1346007514193330178', '663234840530780173', '1363405990866714704'];

// ⛔ Users with these roles are ignored
const IGNORED_ROLES = [''];

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        // ✅ Only run filter in whitelisted channels
        if (!WHITELISTED_CHANNELS.includes(message.channel.id)) return;

        // ⛔ Ignore users with bypass roles
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member && member.roles.cache.some(role => IGNORED_ROLES.includes(role.id))) {
            return;
        }

        const content = message.content;

        // 🔍 Keywords for romantic RP
        const romanticKeywords = /\b(cuddle|hug|kiss|nuzzle|wiggle|snuggle|purr|lick|blush)s?\b/i;

        // 🔍 Check for *RP-style italics*
        const italicMatches = [...content.matchAll(/\*(?!\*)(.+?)\*(?!\*)/g)];
        for (const match of italicMatches) {
            const italic = match[1].trim();

            // Check for romantic keywords within italics
            if (romanticKeywords.test(italic)) {
                return warnAndDelete(message, `*${italic}*`);
            }
            
            // Only flag multi-word italic actions as RP (single-word italics are allowed
            // unless they match the explicit romanticKeywords list above).
            if (/^[a-z]{2,}(?:\s[a-z]{2,}){1,3}[.?!]*$/i.test(italic)) {
                return warnAndDelete(message, `*${italic}*`);
            }
        }
    }
};

async function warnAndDelete(message, matchedPhrase) {
    try {
        await message.delete();

        // Send private warning via DM instead of public channel message
        await message.author.send({
            content: `⚠️ Your message in **${message.guild.name}** (#${message.channel.name}) was removed for roleplay content.\n\nKeep roleplay to your DMs, follow server rules and help keep topics inclusive for everyone!\n\n*Matched phrase: ${matchedPhrase}*`
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
