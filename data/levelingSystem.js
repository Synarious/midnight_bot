/**
 * Leveling System - XP tracking and level management
 * Handles message/voice XP, anti-spam, and level calculations
 */

const pool = require('./database');
const redis = require('./redis');
const { format } = require('date-fns');

// Anti-spam cooldown periods (in seconds)
const ANTI_SPAM_COOLDOWNS = {
    soft: 15,
    low: 30,
    medium: 60,
    high: 120,
    strict: 300, // 5 min
    harsh: 900  // 15 min
};

// XP formula constants
const XP_PER_MESSAGE = 1;
const XP_PER_VOICE_MINUTE = 1;

const levelingSystem = {
    /**
     * Award message XP to a user (with anti-spam check)
     */
    async awardMessageXP(guildId, userId, channelId) {
        try {
            // Get guild config
            const config = await this.getGuildConfig(guildId);
            
            // Check if channel is excluded
            if (config.excluded_message_channels?.includes(channelId)) {
                return { awarded: false, reason: 'excluded_channel' };
            }
            
            // Anti-spam check via Redis
            const cooldownKey = `leveling:cooldown:${guildId}:${userId}`;
            const lastMessage = await redis.get(cooldownKey);
            
            if (lastMessage) {
                const cooldown = ANTI_SPAM_COOLDOWNS[config.anti_spam_level] || ANTI_SPAM_COOLDOWNS.soft;
                return { awarded: false, reason: 'cooldown', cooldown };
            }
            
            // Set cooldown
            const cooldown = ANTI_SPAM_COOLDOWNS[config.anti_spam_level] || ANTI_SPAM_COOLDOWNS.soft;
            await redis.setex(cooldownKey, cooldown, Date.now().toString());
            
            // Award XP via Redis buffer
            const xpKey = `leveling:xp:${guildId}:${userId}`;
            await redis.hincrby(xpKey, 'msg_exp', XP_PER_MESSAGE);
            await redis.expire(xpKey, 3600); // 1 hour buffer
            
            return { awarded: true, xp: XP_PER_MESSAGE };
        } catch (error) {
            console.error('[LevelingSystem] Error awarding message XP:', error);
            return { awarded: false, reason: 'error' };
        }
    },

    /**
     * Award voice XP (called periodically for users in voice channels)
     */
    async awardVoiceXP(guildId, userId, channelId, minutes) {
        try {
            const config = await this.getGuildConfig(guildId);
            
            // Check if channel is excluded
            if (config.excluded_voice_channels?.includes(channelId)) {
                return { awarded: false, reason: 'excluded_channel' };
            }
            
            const xp = Math.floor(minutes * XP_PER_VOICE_MINUTE);
            
            // Award XP via Redis buffer
            const xpKey = `leveling:xp:${guildId}:${userId}`;
            await redis.hincrby(xpKey, 'voice_exp', xp);
            await redis.expire(xpKey, 3600);
            
            return { awarded: true, xp };
        } catch (error) {
            console.error('[LevelingSystem] Error awarding voice XP:', error);
            return { awarded: false, reason: 'error' };
        }
    },

    /**
     * Get guild leveling configuration
     */
    async getGuildConfig(guildId) {
        const cacheKey = `leveling:config:${guildId}`;
        const cached = await redis.get(cacheKey);
        
        if (cached) {
            return JSON.parse(cached);
        }
        
        const result = await pool.query(
            `SELECT * FROM guild_activity_config WHERE guild_id = $1`,
            [guildId]
        );
        
        let config;
        if (result.rows.length === 0) {
            // Ensure guild exists in guilds table first
            await pool.query(
                `INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`,
                [guildId]
            );
            
            // Create default config
            const defaultConfig = await pool.query(
                `INSERT INTO guild_activity_config (guild_id)
                 VALUES ($1)
                 RETURNING *`,
                [guildId]
            );
            config = defaultConfig.rows[0];
        } else {
            config = result.rows[0];
        }
        
        await redis.setex(cacheKey, 300, JSON.stringify(config)); // 5 min cache
        return config;
    },

    /**
     * Calculate level from total XP
     */
    calculateLevel(totalXP) {
        // Standard leveling formula: level = floor(sqrt(totalXP / 100))
        // Adjust multiplier as needed for desired progression
        return Math.floor(Math.sqrt(totalXP / 100));
    },

    /**
     * Get XP required for next level
     */
    getXPForLevel(level) {
        return (level + 1) ** 2 * 100;
    },

    /**
     * Sync XP from Redis to database (run periodically)
     */
    async syncXPToDatabase() {
        try {
            let cursor = '0';
            const batchSize = 1000;
            
            do {
                const reply = await redis.scan(cursor, 'MATCH', 'leveling:xp:*', 'COUNT', batchSize);
                cursor = reply[0];
                const keys = reply[1];
                
                for (const key of keys) {
                    const parts = key.split(':');
                    if (parts.length !== 4) continue;
                    
                    const guildId = parts[2];
                    const userId = parts[3];
                    
                    const xpData = await redis.hgetall(key);
                    const msgExp = parseInt(xpData.msg_exp || 0, 10);
                    const voiceExp = parseInt(xpData.voice_exp || 0, 10);
                    
                    if (msgExp === 0 && voiceExp === 0) continue;
                    
                    // Update database
                    await pool.query(
                        `INSERT INTO member_leveling (guild_id, user_id, msg_exp, voice_exp, last_message_at, level)
                         VALUES ($1, $2, $3, $4, NOW(), $5)
                         ON CONFLICT (guild_id, user_id)
                         DO UPDATE SET 
                            msg_exp = member_leveling.msg_exp + $3,
                            voice_exp = member_leveling.voice_exp + $4,
                            last_message_at = NOW(),
                            level = $5`,
                        [guildId, userId, msgExp, voiceExp, this.calculateLevel(msgExp + voiceExp)]
                    );
                    
                    // Delete processed key
                    await redis.del(key);
                }
            } while (cursor !== '0');
        } catch (error) {
            console.error('[LevelingSystem] Error syncing XP:', error);
        }
    },

    /**
     * Get leaderboard for a guild
     */
    async getLeaderboard(guildId, limit = 100) {
        try {
            const result = await pool.query(
                `SELECT user_id, msg_exp, voice_exp, level,
                        (msg_exp + voice_exp) as total_exp
                 FROM member_leveling
                 WHERE guild_id = $1
                 ORDER BY total_exp DESC
                 LIMIT $2`,
                [guildId, limit]
            );
            
            return result.rows;
        } catch (error) {
            console.error('[LevelingSystem] Error getting leaderboard:', error);
            return [];
        }
    },

    /**
     * Get member's leveling stats
     */
    async getMemberStats(guildId, userId) {
        try {
            const result = await pool.query(
                `SELECT * FROM member_leveling
                 WHERE guild_id = $1 AND user_id = $2`,
                [guildId, userId]
            );
            
            if (result.rows.length === 0) {
                return {
                    guild_id: guildId,
                    user_id: userId,
                    msg_exp: 0,
                    voice_exp: 0,
                    level: 0
                };
            }
            
            return result.rows[0];
        } catch (error) {
            console.error('[LevelingSystem] Error getting member stats:', error);
            return null;
        }
    },

    /**
     * Update guild config
     */
    async updateGuildConfig(guildId, updates) {
        try {
            const fields = [];
            const values = [guildId];
            let paramCount = 2;
            
            for (const [key, value] of Object.entries(updates)) {
                fields.push(`${key} = $${paramCount}`);
                values.push(value);
                paramCount++;
            }
            
            if (fields.length === 0) return false;
            
            await pool.query(
                `UPDATE guild_activity_config
                 SET ${fields.join(', ')}, updated_at = NOW()
                 WHERE guild_id = $1`,
                values
            );
            
            // Invalidate cache
            await redis.del(`leveling:config:${guildId}`);
            
            return true;
        } catch (error) {
            console.error('[LevelingSystem] Error updating config:', error);
            return false;
        }
    },

    /**
     * Get leveling roles for a guild
     */
    async getLevelingRoles(guildId) {
        try {
            const result = await pool.query(
                `SELECT * FROM leveling_roles
                 WHERE guild_id = $1
                 ORDER BY position ASC`,
                [guildId]
            );
            
            return result.rows;
        } catch (error) {
            console.error('[LevelingSystem] Error getting leveling roles:', error);
            return [];
        }
    },

    /**
     * Add or update a leveling role
     */
    async setLevelingRole(guildId, roleId, requirements) {
        try {
            const { msg_exp_requirement, voice_exp_requirement, logic_operator, rolling_period_days, position } = requirements;
            
            await pool.query(
                `INSERT INTO leveling_roles (guild_id, role_id, msg_exp_requirement, voice_exp_requirement, logic_operator, rolling_period_days, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (guild_id, role_id)
                 DO UPDATE SET
                    msg_exp_requirement = $3,
                    voice_exp_requirement = $4,
                    logic_operator = $5,
                    rolling_period_days = $6,
                    position = $7`,
                [guildId, roleId, msg_exp_requirement || 0, voice_exp_requirement || 0, logic_operator || 'OR', rolling_period_days || 90, position || 0]
            );
            
            return true;
        } catch (error) {
            console.error('[LevelingSystem] Error setting leveling role:', error);
            return false;
        }
    },

    /**
     * Remove a leveling role
     */
    async removeLevelingRole(guildId, roleId) {
        try {
            await pool.query(
                `DELETE FROM leveling_roles
                 WHERE guild_id = $1 AND role_id = $2`,
                [guildId, roleId]
            );
            
            return true;
        } catch (error) {
            console.error('[LevelingSystem] Error removing leveling role:', error);
            return false;
        }
    },

    /**
     * Check and assign roles based on XP (should be called periodically or on level up)
     */
    async checkAndAssignRoles(client, guildId, userId) {
        try {
            const stats = await this.getMemberStats(guildId, userId);
            if (!stats) return;
            
            const roles = await this.getLevelingRoles(guildId);
            const config = await this.getGuildConfig(guildId);
            
            const guild = await client.guilds.fetch(guildId);
            const member = await guild.members.fetch(userId);
            
            const rolesToAdd = [];
            const rolesToRemove = [];
            
            for (const roleConfig of roles) {
                const { role_id, msg_exp_requirement, voice_exp_requirement, logic_operator, rolling_period_days } = roleConfig;
                
                // Calculate XP within rolling period (simplified - using total for now)
                // TODO: Implement actual rolling period calculation from member_daily_stats
                const msgXP = stats.msg_exp;
                const voiceXP = stats.voice_exp;
                
                let qualifies = false;
                if (logic_operator === 'AND') {
                    qualifies = msgXP >= msg_exp_requirement && voiceXP >= voice_exp_requirement;
                } else {
                    qualifies = msgXP >= msg_exp_requirement || voiceXP >= voice_exp_requirement;
                }
                
                const hasRole = member.roles.cache.has(role_id.toString());
                
                if (qualifies && !hasRole) {
                    rolesToAdd.push(role_id);
                } else if (!qualifies && hasRole) {
                    rolesToRemove.push(role_id);
                }
            }
            
            // Apply role changes
            if (rolesToAdd.length > 0) {
                await member.roles.add(rolesToAdd);
                console.log(`[LevelingSystem] Added roles to ${userId}:`, rolesToAdd);
            }
            
            if (config.remove_previous_role && rolesToRemove.length > 0) {
                await member.roles.remove(rolesToRemove);
                console.log(`[LevelingSystem] Removed roles from ${userId}:`, rolesToRemove);
            }
        } catch (error) {
            console.error('[LevelingSystem] Error checking roles:', error);
        }
    }
};

module.exports = levelingSystem;
