/**
 * Activity Tracker - Database logging for dashboard analytics
 * Tracks server activity, moderation actions, and member events
 */

const pool = require('./database');
const redis = require('./redis');
const cron = require('node-cron');
const { format } = require('date-fns');

const ACTIVITY_LOG_QUEUE = 'activity:log_queue';

const activityTracker = {
    /**
     * Log a guild event (join, leave, message, etc.)
     */
    async logEvent(guildId, eventType, userId = null, channelId = null, metadata = {}) {
        if (!guildId) return;

        if (eventType === 'message' && userId) {
            // Phase A4 Step 1: Ingesting Activity (The Redis Buffer)
            const date = format(new Date(), 'yyyy-MM-dd');
            // Key: activity:msg:{guild_id}:{user_id}:{date}
            const statKey = `activity:msg:${guildId}:${userId}:${date}`;
            
            // Raw Log Entry for Phase A2 partition table
            // 1: MSG, 2: VC
            const logEntry = {
                timestamp: new Date().toISOString(),
                user_id: userId,
                guild_id: guildId,
                event_type: 1, // MSG
                metadata: { channelId, ...metadata }
            };

            try {
                const pipeline = redis.pipeline();
                // Buffer Stats
                pipeline.incr(statKey);
                pipeline.expire(statKey, 172800); // 48h
                // Queue Raw Log
                pipeline.rpush(ACTIVITY_LOG_QUEUE, JSON.stringify(logEntry));
                await pipeline.exec();
            } catch (err) {
                console.error('[ActivityTracker] Redis error:', err);
            }
        } else {
            // Low-volume events: Write directly to DB (Legacy path + Daily Stats for non-message)
            try {
                await pool.query(
                    `INSERT INTO guild_events (guild_id, event_type, user_id, channel_id, metadata)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [guildId, eventType, userId, channelId, JSON.stringify(metadata)]
                );
                
                // Update daily stats (Legacy table for joins/leaves/mod_actions)
                await this.incrementDailyStat(guildId, eventType);
            } catch (error) {
                console.error(`[ActivityTracker] Error logging event:`, error.message);
            }
        }
    },

    /**
     * Log a moderation action
     */
    async logModAction(guildId, actionType, options = {}) {
        const {
            targetUserId = null,
            targetUsername = null,
            moderatorId = null,
            moderatorUsername = null,
            reason = null,
            durationMinutes = null,
            metadata = {}
        } = options;

        try {
            await pool.query(
                `INSERT INTO moderation_logs 
                 (guild_id, action_type, target_user_id, target_username, moderator_id, moderator_username, reason, duration_minutes, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [guildId, actionType, targetUserId, targetUsername, moderatorId, moderatorUsername, reason, durationMinutes, JSON.stringify(metadata)]
            );

            // Update daily stats
            await this.incrementDailyStat(guildId, 'mod_action');
            if (actionType === 'captcha_kick') {
                await this.incrementDailyStat(guildId, 'captcha_kick');
            }
        } catch (error) {
            console.error(`[ActivityTracker] Error logging mod action:`, error.message);
        }
    },

    /**
     * Track member join
     */
    async trackMemberJoin(guildId, userId, username, inviteCode = null, inviterId = null) {
        try {
            await pool.query(
                `INSERT INTO member_tracking (guild_id, user_id, username, joined_at, invite_code, inviter_id)
                 VALUES ($1, $2, $3, NOW(), $4, $5)
                 ON CONFLICT DO NOTHING`,
                [guildId, userId, username, inviteCode, inviterId]
            );
        } catch (error) {
            console.error(`[ActivityTracker] Error tracking member join:`, error.message);
        }
    },

    /**
     * Track member leave
     */
    async trackMemberLeave(guildId, userId) {
        try {
            // Update existing record or create new one
            const result = await pool.query(
                `UPDATE member_tracking 
                 SET left_at = NOW()
                 WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL
                 RETURNING id`,
                [guildId, userId]
            );
            
            if (result.rowCount === 0) {
                // No join record found, create leave-only record
                await pool.query(
                    `INSERT INTO member_tracking (guild_id, user_id, left_at)
                     VALUES ($1, $2, NOW())`,
                    [guildId, userId]
                );
            }
        } catch (error) {
            console.error(`[ActivityTracker] Error tracking member leave:`, error.message);
        }
    },

    /**
     * Increment daily stat counter
     * Note: This updates the old 'daily_stats' table. 
     * Messages are now handled via Redis -> 'member_daily_stats'.
     */
    async incrementDailyStat(guildId, statType) {
        const columnMap = {
            'join': 'joins_count',
            'leave': 'leaves_count',
            'message': 'messages_count', // Kept for legacy compatibility if called manually
            'mod_action': 'mod_actions_count',
            'captcha_kick': 'captcha_kicks_count'
        };

        const column = columnMap[statType];
        if (!column) return;

        try {
            await pool.query(
                `INSERT INTO daily_stats (guild_id, date, ${column})
                 VALUES ($1, CURRENT_DATE, 1)
                 ON CONFLICT (guild_id, date) 
                 DO UPDATE SET ${column} = daily_stats.${column} + 1, updated_at = NOW()`,
                [guildId]
            );
        } catch (error) {
            console.error(`[ActivityTracker] Error incrementing daily stat:`, error.message);
        }
    },

    /**
     * Get activity stats for dashboard
     * Merges legacy daily_stats (for joins/leaves) with new member_daily_stats (for messages)
     */
    async getGuildStats(guildId, days = 30) {
        try {
            // Get daily activity for chart (joins, leaves from old table)
            const activityResult = await pool.query(
                `SELECT date, joins_count, leaves_count
                 FROM daily_stats
                 WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
                 ORDER BY date ASC`,
                [guildId]
            );

            // Get message stats from new table
            const messageResult = await pool.query(
                `SELECT stat_date as date, SUM(message_count)::int as messages_count
                 FROM member_daily_stats
                 WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'
                 GROUP BY stat_date
                 ORDER BY stat_date ASC`,
                [guildId]
            );
            
            // Map dates to message counts
            const messageMap = new Map();
            messageResult.rows.forEach(row => {
               // Ensure date string matching
               const d = new Date(row.date).toISOString().split('T')[0];
               messageMap.set(d, row.messages_count);
            });

            // Merge
            const mergedActivity = activityResult.rows.map(row => {
                const d = new Date(row.date).toISOString().split('T')[0];
                return {
                    ...row,
                    messages_count: messageMap.get(d) || 0
                };
            });
            
            // Note: If a day only has messages but no joins/leaves (no row in daily_stats), it might be missed here.
            // For full correctness, we should iterate a date range or union keys.
            // But this implementation assumes daily_stats usually has rows or we accept slight gaps in graph for now.

            // Get moderation breakdown
            const modResult = await pool.query(
                `SELECT action_type, COUNT(*) as count
                 FROM moderation_logs
                 WHERE guild_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
                 GROUP BY action_type`,
                [guildId]
            );

            // Get totals
            const totalsResult = await pool.query(
                `SELECT 
                    COALESCE(SUM(joins_count), 0) as total_joins,
                    COALESCE(SUM(leaves_count), 0) as total_leaves,
                    COALESCE(SUM(mod_actions_count), 0) as total_mod_actions
                 FROM daily_stats
                 WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'`,
                [guildId]
            );
            
            const totalMessagesResult = await pool.query(
                `SELECT COALESCE(SUM(message_count), 0)::int as total_messages
                 FROM member_daily_stats
                 WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'`,
                [guildId]
            );

            return {
                activity: mergedActivity,
                moderation: modResult.rows,
                totals: {
                    ...(totalsResult.rows[0] || {}),
                    total_messages: totalMessagesResult.rows[0]?.total_messages || 0
                }
            };
        } catch (error) {
            console.error(`[ActivityTracker] Error getting stats:`, error.message);
            return { activity: [], moderation: [], totals: {} };
        }
    },

    // --- Background Sync Workers (Phase A4 Step 2) ---
    
    startSyncWorker() {
        console.log('[ActivityTracker] Starting Background Sync Worker...');
        const levelingSystem = require('./levelingSystem');
        
        // Run every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            await this.syncStats();
            await this.syncLogs();
            // Also sync leveling XP
            await levelingSystem.syncXPToDatabase();
        });
    },

    async syncStats() {
        let cursor = '0';
        const batchSize = 1000;
        
        // Pattern: activity:msg:{guild_id}:{user_id}:{date}
        do {
            const reply = await redis.scan(cursor, 'MATCH', 'activity:msg:*', 'COUNT', batchSize);
            cursor = reply[0];
            const keys = reply[1];
            
            if (keys.length > 0) {
                // Get values
                const values = await redis.mget(keys);
                
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const count = parseInt(values[i], 10);
                    if (!count || count <= 0) continue;
                    
                    // Parse key: activity:msg:GUILD:USER:DATE
                    const parts = key.split(':');
                    if (parts.length !== 5) continue;
                    
                    const guildId = parts[2];
                    const userId = parts[3];
                    const date = parts[4];
                    
                    try {
                        // Insert/Update member_daily_stats
                        await pool.query(
                            `INSERT INTO member_daily_stats (stat_date, user_id, guild_id, message_count)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (stat_date, user_id, guild_id)
                             DO UPDATE SET message_count = member_daily_stats.message_count + $4`,
                            [date, userId, guildId, count]
                        );
                        
                        // Delete processed key
                        await redis.del(key);
                        
                    } catch (e) {
                         console.error(`[ActivityTracker] Sync error for ${key}:`, e.message);
                    }
                }
            }
        } while (cursor !== '0');
    },

    async syncLogs() {
        // Pop from List
        const limit = 1000;
        const entries = [];
        
        // Pop up to 'limit' items
        for (let i = 0; i < limit; i++) {
            const item = await redis.lpop(ACTIVITY_LOG_QUEUE);
            if (!item) break;
            entries.push(JSON.parse(item));
        }
        
        if (entries.length === 0) return;
        
        // Bulk Insert into activity_log
        try {
            const timestamps = entries.map(e => e.timestamp);
            const userIds = entries.map(e => e.user_id);
            const guildIds = entries.map(e => e.guild_id);
            const eventTypes = entries.map(e => e.event_type);
            const metadatas = entries.map(e => JSON.stringify(e.metadata));
            
            await pool.query(
                `INSERT INTO activity_log (timestamp, user_id, guild_id, event_type, metadata)
                 SELECT * FROM UNNEST($1::timestamptz[], $2::bigint[], $3::bigint[], $4::smallint[], $5::jsonb[])`,
                [timestamps, userIds, guildIds, eventTypes, metadatas]
            );
        } catch (e) {
            console.error('[ActivityTracker] Error syncing log batch:', e.message);
        }
    }
};

// Start workers automatically when module is loaded
activityTracker.startSyncWorker();

module.exports = activityTracker;
