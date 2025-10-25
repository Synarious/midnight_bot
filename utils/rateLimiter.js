/**
 * Centralized Rate Limiting Utility
 * Supports both slash commands and prefix commands
 * Each command/feature defines its own rate limits
 */

const { MessageFlags } = require('discord.js');

// Rate limiting: simple in-memory cooldown tracker
// Structure: Map<userId, Map<commandOrInteractionId, timestamp>>
const rateLimits = new Map();

// Rate limit statistics tracking
// Structure: Array of { timestamp, userId, identifier, type }
const rateLimitHits = [];

/**
 * Check if user is rate limited for this command or interaction
 * @param {string} userId - Discord user ID
 * @param {string} identifier - Command name or interaction customId
 * @param {number} limitMs - Rate limit duration in milliseconds
 * @returns {Object} - { limited: boolean, remainingMs: number }
 */
function checkRateLimit(userId, identifier, limitMs, touch = true) {
    if (!rateLimits.has(userId)) {
        rateLimits.set(userId, new Map());
    }
    
    const userLimits = rateLimits.get(userId);
    let lastInteraction = userLimits.get(identifier);
    
    // Use only nowDate and derived values (store timestamps internally as numeric ms)
    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const nowIso = nowDate.toISOString();

    // Always debug for all rate limits
    console.log(`[RateLimit Debug] CHECK user=${userId} id=${identifier} last=${lastInteraction} now=${nowIso}`);

    // Normalize lastInteraction into milliseconds (support legacy formats)
    let lastMs = null;
    if (lastInteraction !== undefined && lastInteraction !== null) {
        if (typeof lastInteraction === 'number') {
            // Stored as seconds (legacy) or milliseconds
            lastMs = lastInteraction < 1e12 ? lastInteraction * 1000 : lastInteraction;
        } else if (typeof lastInteraction === 'string') {
            const parsed = Date.parse(lastInteraction);
            if (!Number.isNaN(parsed)) {
                lastMs = parsed;
            } else {
                // Maybe numeric string
                const num = Number(lastInteraction);
                if (!Number.isNaN(num)) lastMs = num < 1e12 ? num * 1000 : num;
            }
        }
    }

    // Defensive: clamp future timestamps
    if (lastMs && lastMs > nowMs) {
        console.warn(`[RateLimit] Detected future timestamp for user=${userId} id=${identifier} last=${lastInteraction} > now=${nowIso}. Clamping to now.`);
        lastMs = nowMs;
    }

    if (lastMs) {
        const timeSince = nowMs - lastMs;
        if (timeSince < limitMs) {
            // Track rate limit hit for statistics (store numeric timestamps)
            rateLimitHits.push({
                timestamp: nowMs,
                userId,
                identifier,
                limitMs
            });
            const remaining = limitMs - timeSince;

            // Always debug for all rate limits
            console.log(`[RateLimit Debug] HIT user=${userId} id=${identifier} last=${lastInteraction} now=${nowIso} limitMs=${limitMs} timeSince=${timeSince} remainingMs=${remaining}`);

            return {
                limited: true,
                remainingMs: remaining
            };
        }
    }
    
    // Update timestamp only if requested (touch === true)
    if (touch) {
        // Store as numeric milliseconds for consistency
        userLimits.set(identifier, nowMs);
        console.log(`[RateLimit Debug] SET user=${userId} id=${identifier} now=${nowIso}`);
    }
    
    // Cleanup old entries for this user (run periodically, not every time)
    // Only cleanup if we have many entries OR randomly (10% chance)
    if (userLimits.size > 15 || Math.random() < 0.1) {
        const cutoff = nowMs - 60000; // 1 minute ago (ms)
        for (const [key, timestamp] of userLimits.entries()) {
            let tsMs = null;
            if (typeof timestamp === 'number') tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            else if (typeof timestamp === 'string') {
                const parsed = Date.parse(timestamp);
                if (!Number.isNaN(parsed)) tsMs = parsed;
                else {
                    const asNum = Number(timestamp);
                    if (!Number.isNaN(asNum)) tsMs = asNum < 1e12 ? asNum * 1000 : asNum;
                }
            }

            if (tsMs !== null && tsMs < cutoff) {
                userLimits.delete(key);
            }
        }
        
        // If user has no recent activity, remove them entirely
        if (userLimits.size === 0) {
            rateLimits.delete(userId);
        }
    }
    
    return { limited: false, remainingMs: 0 };
}

/**
 * Clear all rate limits for a user (useful for debugging/testing)
 * @param {string} userId
 */
function clearUserRateLimits(userId) {
    if (rateLimits.has(userId)) {
        rateLimits.delete(userId);
        return true;
    }
    return false;
}

/**
 * Touch (update) the rate limit timestamp for a user/identifier to now.
 * Useful when you want to record the usage only after the handler actually processed the interaction.
 * @param {string} userId
 * @param {string} identifier
 */
function touchRateLimit(userId, identifier) {
    if (!rateLimits.has(userId)) {
        rateLimits.set(userId, new Map());
    }
    const userLimits = rateLimits.get(userId);
    let now = Date.now();

    // Defensive: ensure we don't accidentally write a seconds-based value or a future timestamp
    if (now < 1e12) {
        // extremely unlikely, but normalize anyway
        now = now * 1000;
    }

    userLimits.set(identifier, now);
}

/**
 * Send a rate limit response to the user
 * Supports both slash commands and prefix commands
 * @param {import('discord.js').Interaction|import('discord.js').Message} context - Interaction or Message
 * @param {number} remainingMs - Remaining cooldown time in milliseconds
 * @param {string} commandName - Name of the command being rate limited
 */
async function sendRateLimitResponse(context, remainingMs, commandName) {
    const remainingSec = Math.ceil(remainingMs / 1000);
    const content = `⏱️ Slow down! You can use \`${commandName}\` again in **${remainingSec} second${remainingSec !== 1 ? 's' : ''}**.`;
    
    try {
        // Handle Discord.js Interaction (slash commands, buttons, selects, modals)
        if (context.isCommand?.() || context.isButton?.() || context.isStringSelectMenu?.() || context.isModalSubmit?.()) {
            if (context.replied || context.deferred) {
                await context.followUp({ content, flags: MessageFlags.Ephemeral });
            } else {
                await context.reply({ content, flags: MessageFlags.Ephemeral });
            }
        }
        // Handle Message (prefix commands)
        else if (context.reply) {
            await context.reply(content);
        }
    } catch (error) {
        console.error('[RateLimit] Failed to send rate limit message:', error);
    }
}

/**
 * Get rate limit statistics for a time window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Object} - Statistics object
 */
function getRateLimitStats(windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    const hitsInWindow = rateLimitHits.filter(hit => hit.timestamp >= cutoff);
    
    // Count by identifier
    const byIdentifier = {};
    const uniqueUsers = new Set();
    
    for (const hit of hitsInWindow) {
        byIdentifier[hit.identifier] = (byIdentifier[hit.identifier] || 0) + 1;
        uniqueUsers.add(hit.userId);
    }
    
    // Get top offenders
    const topIdentifiers = Object.entries(byIdentifier)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    return {
        total: hitsInWindow.length,
        uniqueUsers: uniqueUsers.size,
        byIdentifier,
        topIdentifiers
    };
}

/**
 * Get active user count for statistics
 */
function getActiveUserCount() {
    return rateLimits.size;
}

/**
 * Get active cooldown counts per identifier given a mapping of identifier -> limitMs.
 * This allows higher-level code to determine how many users are currently on cooldown
 * for each command/interaction.
 * @param {Object} limitsMap - Object mapping identifier -> limitMs
 * @returns {Object} - mapping identifier -> activeUserCount
 */
function getActiveCooldownCounts(limitsMap = {}) {
    const now = Date.now();
    const counts = {};

    for (const [userId, userLimits] of rateLimits.entries()) {
        for (const [identifier, timestamp] of userLimits.entries()) {
            // Only consider identifiers we were asked about
            const limitMs = limitsMap[identifier];
            if (!limitMs) continue;

            // Normalize timestamp to ms
            let tsMs = null;
            if (typeof timestamp === 'number') {
                tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            } else if (typeof timestamp === 'string') {
                const parsed = Date.parse(timestamp);
                if (!Number.isNaN(parsed)) tsMs = parsed;
                else {
                    const asNum = Number(timestamp);
                    if (!Number.isNaN(asNum)) tsMs = asNum < 1e12 ? asNum * 1000 : asNum;
                }
            }

            if (!tsMs) continue;
            if (now - tsMs < limitMs) {
                counts[identifier] = (counts[identifier] || 0) + 1;
            }
        }
    }

    return counts;
}

/**
 * Get total tracked rate limit hits
 */
function getTotalHitsTracked() {
    return rateLimitHits.length;
}

// Global cleanup: runs every 5 minutes to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    const cutoff = now - 300000; // 5 minutes ago
    let cleanedUsers = 0;
    let cleanedEntries = 0;
    
    for (const [userId, userLimits] of rateLimits.entries()) {
        // Remove old entries
        for (const [key, timestamp] of userLimits.entries()) {
            if (timestamp < cutoff) {
                userLimits.delete(key);
                cleanedEntries++;
            }
        }
        
        // Remove user entirely if they have no recent activity
        if (userLimits.size === 0) {
            rateLimits.delete(userId);
            cleanedUsers++;
        }
    }
    
    // Clean up old rate limit hit statistics (keep last 7 days)
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    // Find the first index that should be kept
    let keepFromIndex = 0;
    while (keepFromIndex < rateLimitHits.length && rateLimitHits[keepFromIndex].timestamp < sevenDaysAgo) {
        keepFromIndex++;
    }
    
    // Remove old entries efficiently
    if (keepFromIndex > 0) {
        rateLimitHits.splice(0, keepFromIndex);
    }
    
    if (cleanedUsers > 0 || cleanedEntries > 0 || keepFromIndex > 0) {
        console.log(`[RateLimit Cleanup] Removed ${cleanedUsers} inactive users, ${cleanedEntries} old entries, and ${keepFromIndex} old statistics. Active users: ${rateLimits.size}, Stats tracked: ${rateLimitHits.length}`);
    }
}, 300000); // Run every 5 minutes

module.exports = {
    checkRateLimit,
    sendRateLimitResponse,
    getRateLimitStats,
    getActiveCooldownCounts,
    getActiveUserCount,
    getTotalHitsTracked,
    clearUserRateLimits,
    touchRateLimit,
    // Test-only accessor: return the internal map so tests can simulate timestamps
    __test_get_map: () => rateLimits,
};
