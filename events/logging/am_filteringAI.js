// messageCreate.js

const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { getLogChannelId, filteringAI, isOpenAIEnabled } = require('../../data/database.js');

// --- CONFIGURATION ---

const debug = false
const adminRoleId = process.env.MODERATION_ADMIN_ROLE_ID;
const moderationModel = process.env.OPENAI_MODERATION_MODEL || 'text-moderation-latest';

const softCategoryThresholds = {
    'hate': 0.2,
    'hate/threatening': 0.2,
    'harassment': 0.6,
    'harassment/threatening': 0.6,
    'self-harm': 0.1,
    'self-harm/intent': 0.1,
    'self-harm/instructions': 0.1,
    'sexual': 0.05,
    'sexual/minors': 0.05,
    'violence': 0.8,
    'violence/graphic': 0.8,
};

const stdCategoryThresholds = {
    'hate': 0.5,
    'hate/threatening': 0.5,
    'harassment': 0.7,
    'harassment/threatening': 0.7,
    'self-harm': 0.4,
    'self-harm/intent': 0.4,
    'self-harm/instructions': 0.4,
    'sexual': 0.1,
    'sexual/minors': 0.2,
    'violence': 0.87,
    'violence/graphic': 0.87,
};

const hardCategoryThresholds = {
    'hate': 0.6,
    'hate/threatening': 0.6,
    'harassment': 0.8,
    'harassment/threatening': 0.8,
    'self-harm': 0.5,
    'self-harm/intent': 0.5,
    'self-harm/instructions': 0.5,
    'sexual': 0.3,
    'sexual/minors': 0.4,
    'violence': 0.92,
    'violence/graphic': 0.92,
};

// CORRECT: This mapping aligns with the official categories.
const infractionCategories = {
    hate: ['hate', 'hate/threatening'],
    harassment: ['harassment', 'harassment/threatening'],
    self_harm: ['self-harm', 'self-harm/intent', 'self-harm/instructions'],
    sexual: ['sexual', 'sexual/minors'],
    violence: ['violence', 'violence/graphic'],
};

// --- HELPER FUNCTIONS ---

async function checkMessageModeration(content) {
    try {
        if (debug) console.log(`[MODERATION] Sending content to OpenAI Moderation API using model: ${moderationModel}`);
        const response = await axios.post(
            'https://api.openai.com/v1/moderations',
            // --- THE ONLY REQUIRED CHANGE IS HERE ---
            // We now specify the model to use.
            {
                input: content,
                model: moderationModel,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const result = response.data.results?.[0];
        if (!result) {
            console.error('Moderation API error: No moderation result returned');
            return { flagged: false, categoryScores: {}, error: 'No result' };
        }

        if (debug) {
            console.log('[MODERATION] API result:', {
                flagged: result.flagged,
                categories: result.categories,
                category_scores: result.category_scores,
            });
        }

        return {
            flagged: result.flagged,
            categories: result.categories,
            categoryScores: result.category_scores,
            message: content,
        };
    } catch (error) {
        console.error('Moderation API error:', {
            status: error.response?.status || 'No status',
            message: error.response?.data?.error?.message || error.message,
            type: error.response?.data?.error?.type || 'Unknown',
        });

        return { flagged: false, categoryScores: {}, error: 'API failure' };
    }
}

function getTriggeredCategories(scores, thresholds) {
    return Object.entries(scores)
        .filter(([cat, score]) => score >= (thresholds[cat] || Infinity))
        .map(([cat, score]) => ({ cat, score }));
}

// --- DISCORD EVENT ---
// The rest of your 'execute' logic remains unchanged as it was already correctly structured.
module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (message.author.bot) {
            if (debug) console.log('[MODERATION] Ignored message from bot.');
            return;
        }

        const client = message.client;
        const db = client.botStorage;
        if (!db) {
            console.error('Database not initialized on client');
            return;
        }

        const messageContent = message.content;
        if (!messageContent) {
            if (debug) console.log('[MODERATION] Empty message content, skipping.');
            return;
        }

        // Exclude messages that contain the token "$slut" in any casing
        const lcContent = messageContent.toLowerCase();
        if (lcContent.includes('$slut')) {
            if (debug) console.log('[MODERATION] Message contains excluded token "$slut", skipping OpenAI moderation.');
            return;
        }

        const isEnabled = await isOpenAIEnabled(message.guild.id);
        if (!isEnabled) {
            if (debug) console.log('[MODERATION] OpenAI moderation is disabled for this guild.');
            return;
        }

        if (debug) console.log(`[MODERATION] Checking message from ${message.author.tag}: "${messageContent}"`);

        const moderationResult = await checkMessageModeration(messageContent);
        if (moderationResult.error) {
            if (debug) console.log(`[MODERATION] Skipping due to API error: ${moderationResult.error}`);
            return;
        }

        const scores = moderationResult.categoryScores;
        if (!scores || Object.keys(scores).length === 0) {
            if (debug) console.log('[MODERATION] No category scores returned, skipping.');
            return;
        }

        let severity = null;
        let triggered = [];

        triggered = getTriggeredCategories(scores, hardCategoryThresholds);
        if (triggered.length > 0) {
            severity = 'hard';
        } else {
            triggered = getTriggeredCategories(scores, stdCategoryThresholds);
            if (triggered.length > 0) {
                severity = 'std';
            } else {
                triggered = getTriggeredCategories(scores, softCategoryThresholds);
                if (triggered.length > 0) {
                    severity = 'soft';
                }
            }
        }

        if (debug) {
            console.log('[MODERATION] Triggered categories:', triggered);
            console.log('[MODERATION] Severity determined:', severity);
        }

        if (!severity) {
            if (debug) console.log('[MODERATION] No severity triggered, returning early.');
            return;
        }

        const logChannelId = await getLogChannelId(message.guild.id);
        const messageLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;

        const embed = new EmbedBuilder()
            .setColor(severity === 'hard' ? 0xFF0000 : severity === 'std' ? 0xFFA500 : 0xFFFF00)
            .setTitle(`🚨 Flagged (${severity.toUpperCase()})`)
            .setURL(messageLink)
            .setDescription([
                `- User: <@${message.author.id}> (${message.author.tag})`,
                `- Infractions: ${triggered.map(t => `${t.cat} (${(t.score * 100).toFixed(1)}%)`).join(', ')}`,
                `\`\`\`${messageContent.length > 300 ? messageContent.slice(0, 297) + '...' : messageContent}\`\`\``,
                `- Time: <t:${Math.floor(Date.now() / 1000)}:R> • ID: ${message.author.id}`
            ].join('\n'));

        if (logChannelId) {
            try {
                const logChannel = await message.guild.channels.fetch(logChannelId);
                if (logChannel) {
                    const mention = severity === 'hard' && adminRoleId ? `<@&${adminRoleId}> ` : '';
                    await logChannel.send({ content: mention, embeds: [embed] });
                    if (debug) console.log('[MODERATION] Sent log message successfully.');
                }
            } catch (e) {
                console.error('[MODERATION] Failed to fetch or send to log channel:', e);
            }
        } else {
            if (debug) console.log('[MODERATION] No log channel configured for this guild.');
        }

        if (severity === 'std' || severity === 'hard') {
            const userInfractions = {
                hate: 0,
                harassment: 0,
                self_harm: 0,
                sexual: 0,
                violence: 0,
            };

            for (const [group, categories] of Object.entries(infractionCategories)) {
                if (categories.some(cat =>
                    (severity === 'hard' && (scores[cat] || 0) >= (hardCategoryThresholds[cat] || 1)) ||
                    (severity === 'std' && (scores[cat] || 0) >= (stdCategoryThresholds[cat] || 1))
                )) {
                    userInfractions[group]++;
                }
            }

            if (debug) console.log('[MODERATION] Storing user infractions:', userInfractions);

            filteringAI(
                message.guild.id,
                message.author.id,
                message.id,
                message.channel.id,
                new Date().toISOString(),
                userInfractions,
                messageContent
            );
        }
    },
};