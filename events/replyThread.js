const { Events, ThreadAutoArchiveDuration } = require('discord.js');
const { getReplyThreadSettings } = require('../data/automodSettings');

// Default dating phrases regex
const DEFAULT_DATING_REGEX = /\b(straight|sexuality|single|bisexual|lesbian|𝐬𝐞𝐱𝐮𝐚𝐥𝐢𝐭𝐲|𝔰𝔢𝔵𝔲𝔞𝔩𝔦𝔱𝔶|𝖘𝖊𝖝𝖚𝖆𝖑𝖎𝖙𝖞|𝓼𝓮𝔁𝓾𝓪𝓵𝓲𝓽𝔂|𝓈𝑒𝓍𝓊𝒶𝓁𝒾𝓉𝓎|𝕤𝕖𝕩𝕦𝕒𝕝𝕚𝕥𝕪|🅂🄴🅇🅄🄰🄻🄸🅃🅈|𝘀𝗲𝘅𝘂𝗮𝗹𝗶𝘁𝘆|𝘴𝘦𝘹𝘶𝘢𝘭𝘪𝘵𝘺|𝙨𝙚𝙭𝙪𝙖𝙡𝙞𝙩𝙮|𝚜𝚎𝚡𝚞𝚊𝚕𝚒𝚝𝚢)\b/i;

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignore bots and DMs
        if (message.author.bot || !message.guild) return;

        try {
            // Get guild-specific settings from database
            const settings = await getReplyThreadSettings(message.guild.id);
            
            // If no settings exist or feature is disabled, skip
            if (!settings || !settings.enabled) return;

            const channelId = message.channel.id;

            // Special handling for introduction channel - check for dating language first
            const introChannelId = settings.introduction_channel_id;
            if (introChannelId && channelId === introChannelId) {
                // Build dating regex from settings
                const datingRegex = settings.dating_phrases_regex 
                    ? new RegExp(settings.dating_phrases_regex, 'i')
                    : DEFAULT_DATING_REGEX;
                    
                if (datingRegex.test(message.content)) {
                    return handleDatingLanguage(message, settings.debug_channel_id);
                }
            }

            // Check if this is a configured thread channel
            const threadChannels = settings.channels || {};
            if (!threadChannels[channelId]) return;

            // Only create threads for non-thread messages
            if (message.channel.isThread()) return;

            // Wait 2 seconds before creating thread
            await sleep(2000);

            try {
                await createAutoThread(message, channelId, threadChannels);
            } catch (error) {
                console.error(`[ReplyThread] Failed to create thread in ${channelId}:`, error);
            }
        } catch (error) {
            console.error('[ReplyThread] Error processing message:', error);
        }
    }
};

/**
 * Creates an automatic thread for a message
 */
async function createAutoThread(message, channelId, threadChannels) {
    const config = threadChannels[channelId];
    const threadName = `${config.emoji || '📌'}${message.author.username} - ${config.category}`;

    try {
        // Create thread from the message
        const thread = await message.startThread({
            name: threadName,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
            reason: 'Auto-thread creation for organized replies'
        });

        // Wait 2 seconds before logging
        await sleep(2000);

        console.log(`[ReplyThread] Created thread "${threadName}" for message ${message.id}`);
    } catch (error) {
        console.error(`[ReplyThread] Error creating thread:`, error);
        throw error;
    }
}

/**
 * Handles messages in introduction channel that contain dating language
 */
async function handleDatingLanguage(message, debugChannelId) {
    try {
        // Send warning message
        const warningMsg = await message.channel.send({
            content: `# ⚠️ Dating Language Detected - Post Will Be Deleted | ${message.author}\n` +
                `### Delete These Phrases\n` +
                `\`\`\`straight, single, bisexual, sexuality, lesbian\`\`\`\n` +
                `- To copy your message again choose Edit > Select All > Copy > Close Edit > Paste > Change It > **Then Send As A New Message**\n` +
                `-# We're not dating server & content like this causes us to become one. Be mindful and follow server rules ❤️`,
            allowedMentions: { users: [message.author.id] }
        });

        // Log to debug channel if configured
        if (debugChannelId) {
            const debugChannel = await message.client.channels.fetch(debugChannelId).catch(() => null);
            if (debugChannel) {
                await debugChannel.send({
                    content: `**Automod Debug: Introduction Removed For Dating Phrases** ${message.author}\n` +
                        `**Content**\n` +
                        `\`\`\`${message.content.slice(0, 1900)}\`\`\``,
                    allowedMentions: { users: [] }
                });
            }
        }

        // Delete warning message after 75 seconds
        setTimeout(async () => {
            await warningMsg.delete().catch(() => {});
        }, 75000);

        // Delete original message after 75 seconds
        setTimeout(async () => {
            await message.delete().catch(() => {});
        }, 75000);

        console.log(`[ReplyThread] Flagged dating language in introduction from ${message.author.tag}`);
    } catch (error) {
        console.error('[ReplyThread] Error handling dating language:', error);
    }
}

/**
 * Utility function to sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
