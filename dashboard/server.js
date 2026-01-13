/**
 * Midnight Bot Dashboard - Express Server
 * A secure local web dashboard for managing bot settings
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');
const axios = require('axios'); // Ensure axios is required for API calls

// Database connection (shared with bot via same PG* env vars)
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'midnight_bot',
    port: parseInt(process.env.PGPORT) || 5432,
});

async function ensureOnboardingSchema() {
    // Dashboard runs against the shared bot database but doesn't use the bot's migration runner.
    // Keep onboarding config schema in sync so the UI can create categories/roles.
    await pool.query('ALTER TABLE onboarding_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE onboarding_settings ADD COLUMN IF NOT EXISTS log_channel_id TEXT');
    await pool.query('ALTER TABLE onboarding_settings ADD COLUMN IF NOT EXISTS welcome_channel_id TEXT');
    await pool.query('UPDATE onboarding_settings SET enabled = TRUE WHERE enabled IS NULL');

    await pool.query("ALTER TABLE onboarding_categories ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT ''");
    await pool.query("ALTER TABLE onboarding_categories ADD COLUMN IF NOT EXISTS selection_type TEXT DEFAULT 'REQUIRED_ONE'");
    await pool.query('ALTER TABLE onboarding_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE onboarding_categories ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE onboarding_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await pool.query(
        `UPDATE onboarding_categories
            SET
                emoji = COALESCE(emoji, ''),
                selection_type = COALESCE(selection_type, 'REQUIRED_ONE'),
                sort_order = COALESCE(sort_order, 0),
                enabled = COALESCE(enabled, TRUE),
                updated_at = COALESCE(updated_at, NOW())`
    );
    await pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_categories_guild_name ON onboarding_categories (guild_id, name)'
    );
    await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_onboarding_categories_guild_sort ON onboarding_categories (guild_id, sort_order)'
    );

    await pool.query('ALTER TABLE onboarding_roles ADD COLUMN IF NOT EXISTS name TEXT');
    await pool.query("ALTER TABLE onboarding_roles ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT ''");
    await pool.query('ALTER TABLE onboarding_roles ADD COLUMN IF NOT EXISTS key TEXT');
    await pool.query('ALTER TABLE onboarding_roles ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE onboarding_roles ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE onboarding_roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_roles_guild_category_role ON onboarding_roles (guild_id, category_id, role_id)'
    );
    await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_onboarding_roles_category_sort ON onboarding_roles (category_id, sort_order)'
    );
}

async function ensureDashboardSchema() {
    // Keep guild_settings and command tables compatible for dashboard features.
    await pool.query("ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS bot_timezone TEXT DEFAULT 'UTC'");
    await pool.query("ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'non_premium'");
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS enable_leveling BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS enable_economy BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS enable_role_menus BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS auto_role_enabled BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS auto_role_id TEXT');

    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ch_inviteLog TEXT');
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ch_permanentInvites TEXT');
    await pool.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ch_memberJoin TEXT');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS command_registry (
            command_name TEXT PRIMARY KEY,
            category TEXT,
            has_slash BOOLEAN DEFAULT FALSE,
            has_prefix BOOLEAN DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS guild_command_settings (
            guild_id TEXT NOT NULL,
            command_name TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (guild_id, command_name)
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_guild_command_settings_guild ON guild_command_settings (guild_id)');
}

// ==================== DATABASE HELPERS ====================

async function getGuildSettings(guildId) {
    const result = await pool.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    if (result.rows.length > 0) return result.rows[0];

    await pool.query(
        'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
        [guildId]
    );


    // Logging ignore lists (some DBs may be missing these)
    await pool.query(`
        ALTER TABLE guild_settings
            ADD COLUMN IF NOT EXISTS ch_categoryIgnoreAutomod TEXT[] DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS ch_channelIgnoreAutomod TEXT[] DEFAULT '{}'
    `);
    const created = await pool.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return created.rows[0] || null;
}

async function updateGuildSetting(guildId, key, value) {
    // Key is whitelisted at the route layer. Keep this helper strict about injection.
    if (!/^[a-zA-Z0-9_]+$/.test(String(key))) {
        throw new Error('Invalid setting key');
    }

    await pool.query(
        `
        INSERT INTO guild_settings (guild_id, ${key})
        VALUES ($1, $2)
        ON CONFLICT (guild_id)
        DO UPDATE SET ${key} = EXCLUDED.${key}
    `,
        [guildId, value]
    );
}

// Password hashing using scrypt
async function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            resolve(salt + ':' + derivedKey.toString('hex'));
        });
    });
}

async function verifyPassword(password, hash) {
    return new Promise((resolve, reject) => {
        const [salt, key] = hash.split(':');
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
        });
    });
}

// Password validation - enforce minimum security requirements
function validatePassword(password) {
    if (!password || password.length < 12) {
        return { valid: false, error: 'Password must be at least 12 characters long' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one number' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one special character' };
    }
    return { valid: true };
}

// Hash session token for secure storage
function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Auth Database Functions
const authDb = {
    async getUserByUsername(username) {
        const result = await pool.query(
            'SELECT * FROM dashboard_users WHERE username = $1',
            [username]
        );
        return result.rows[0];
    },

    async getAllUsers() {
        const result = await pool.query(
            'SELECT id, username, is_admin, discord_id, created_at, last_login_at FROM dashboard_users ORDER BY created_at'
        );
        return result.rows;
    },

    async createLocalUser(username, password) {
        const passwordHash = await hashPassword(password);
        const result = await pool.query(
            'INSERT INTO dashboard_users (username, password_hash, is_admin) VALUES ($1, $2, false) RETURNING id, username, is_admin',
            [username, passwordHash]
        );
        return result.rows[0];
    },

    async createAdminUser(username, password) {
        const passwordHash = await hashPassword(password);
        const result = await pool.query(
            'INSERT INTO dashboard_users (username, password_hash, is_admin) VALUES ($1, $2, true) RETURNING id, username, is_admin',
            [username, passwordHash]
        );
        return result.rows[0];
    },

    async updateUserLogin(userId) {
        await pool.query(
            'UPDATE dashboard_users SET last_login_at = NOW() WHERE id = $1',
            [userId]
        );
    },

    async deleteUser(userId) {
        await pool.query('DELETE FROM dashboard_users WHERE id = $1', [userId]);
    },

    async deleteUserSessions(userId) {
        await pool.query('DELETE FROM dashboard_sessions WHERE user_id = $1', [userId]);
    },

    async createSession(userId, ipAddress, userAgent) {
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashSessionToken(sessionToken); // Store hash, not plaintext
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours (reduced from 7 days)
        
        // Clean up old sessions for this user (limit concurrent sessions)
        await pool.query(
            'DELETE FROM dashboard_sessions WHERE user_id = $1 AND expires_at < NOW()',
            [userId]
        );
        
        await pool.query(
            'INSERT INTO dashboard_sessions (user_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
            [userId, tokenHash, expiresAt, ipAddress, userAgent]
        );
        
        return { sessionToken, expiresAt }; // Return plaintext token to client
    },

    async getSession(sessionToken) {
        const tokenHash = hashSessionToken(sessionToken); // Hash the provided token for lookup
        const result = await pool.query(
            `SELECT s.*, u.username, u.is_admin, u.discord_id 
             FROM dashboard_sessions s 
             JOIN dashboard_users u ON s.user_id = u.id 
             WHERE s.session_token = $1 AND s.expires_at > NOW()`,
            [tokenHash]
        );
        return result.rows[0];
    },

    async deleteSession(sessionToken) {
        const tokenHash = hashSessionToken(sessionToken);
        await pool.query('DELETE FROM dashboard_sessions WHERE session_token = $1', [tokenHash]);
    },

    verifyPassword
};

// Automod Settings Functions
const automodSettings = {
    // No Roleplay Settings
    async getNoRoleplaySettings(guildId) {
        const result = await pool.query(
            'SELECT * FROM automod_no_roleplay WHERE guild_id = $1',
            [guildId]
        );
        return result.rows[0] || { enabled: true };
    },

    async setNoRoleplaySettings(guildId, settings) {
        const { enabled, whitelisted_channels, ignored_roles, romantic_keywords } = settings;
        await pool.query(
            `INSERT INTO automod_no_roleplay (guild_id, enabled, whitelisted_channels, ignored_roles, romantic_keywords)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (guild_id) DO UPDATE SET
             enabled = EXCLUDED.enabled, whitelisted_channels = EXCLUDED.whitelisted_channels,
             ignored_roles = EXCLUDED.ignored_roles, romantic_keywords = EXCLUDED.romantic_keywords, updated_at = NOW()`,
            [guildId, enabled ?? true, JSON.stringify(whitelisted_channels || []), JSON.stringify(ignored_roles || []), romantic_keywords || 'cuddle|hug|kiss|nuzzle|wiggle|snuggle|purr|lick|blush']
        );
    },

    // No Danger Edits Settings
    async getNoDangerEditsSettings(guildId) {
        const result = await pool.query(
            'SELECT * FROM automod_no_danger_edits WHERE guild_id = $1',
            [guildId]
        );
        return result.rows[0] || { enabled: true };
    },

    async setNoDangerEditsSettings(guildId, settings) {
        const { enabled, forbidden_words_regex, ignored_channels, ignored_roles, log_channel_id, ping_role_id, delete_message, mute_user, mute_duration_minutes } = settings;
        
        // Validate regex pattern to prevent ReDoS attacks
        if (forbidden_words_regex) {
            try {
                // Test the regex and set timeout to catch ReDoS
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Regex pattern too complex')), 1000)
                );
                const testPromise = Promise.resolve(new RegExp(forbidden_words_regex, 'i'));
                await Promise.race([testPromise, timeoutPromise]);
            } catch (error) {
                throw new Error('Invalid or overly complex regex pattern: ' + error.message);
            }
        }
        
        // Validate Discord IDs if provided
        if (log_channel_id && !isValidSnowflake(log_channel_id)) {
            throw new Error('Invalid log_channel_id format');
        }
        if (ping_role_id && !isValidSnowflake(ping_role_id)) {
            throw new Error('Invalid ping_role_id format');
        }
        
        // Validate mute duration is reasonable (max 10080 = 7 days)
        const muteDuration = mute_duration_minutes || 60;
        if (muteDuration < 1 || muteDuration > 10080) {
            throw new Error('Mute duration must be between 1 and 10080 minutes');
        }
        
        await pool.query(
            `INSERT INTO automod_no_danger_edits (guild_id, enabled, forbidden_words_regex, ignored_channels, ignored_roles, log_channel_id, ping_role_id, delete_message, mute_user, mute_duration_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (guild_id) DO UPDATE SET
             enabled = EXCLUDED.enabled, forbidden_words_regex = EXCLUDED.forbidden_words_regex,
             ignored_channels = EXCLUDED.ignored_channels, ignored_roles = EXCLUDED.ignored_roles,
             log_channel_id = EXCLUDED.log_channel_id, ping_role_id = EXCLUDED.ping_role_id,
             delete_message = EXCLUDED.delete_message, mute_user = EXCLUDED.mute_user,
             mute_duration_minutes = EXCLUDED.mute_duration_minutes, updated_at = NOW()`,
            [guildId, enabled ?? true, forbidden_words_regex, JSON.stringify(ignored_channels || []), JSON.stringify(ignored_roles || []), log_channel_id, ping_role_id, delete_message ?? true, mute_user ?? true, muteDuration]
        );
    },

    // Reply Thread Settings
    async getReplyThreadSettings(guildId) {
        const result = await pool.query(
            'SELECT * FROM reply_thread_settings WHERE guild_id = $1',
            [guildId]
        );
        const settings = result.rows[0] || { enabled: true };
        
        // Get thread channels
        const channelsResult = await pool.query(
            'SELECT channel_id FROM reply_thread_channels WHERE guild_id = $1',
            [guildId]
        );
        settings.thread_channels = channelsResult.rows.map(r => r.channel_id);
        
        return settings;
    },

    async setReplyThreadSettings(guildId, settings) {
        const { enabled, introduction_channel_id, debug_channel_id, dating_phrases_regex, dating_warning_message, thread_channels } = settings;
        
        await pool.query(
            `INSERT INTO reply_thread_settings (guild_id, enabled, introduction_channel_id, debug_channel_id, dating_phrases_regex, dating_warning_message)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (guild_id) DO UPDATE SET
             enabled = EXCLUDED.enabled, introduction_channel_id = EXCLUDED.introduction_channel_id,
             debug_channel_id = EXCLUDED.debug_channel_id, dating_phrases_regex = EXCLUDED.dating_phrases_regex,
             dating_warning_message = EXCLUDED.dating_warning_message, updated_at = NOW()`,
            [guildId, enabled ?? true, introduction_channel_id, debug_channel_id, dating_phrases_regex, dating_warning_message]
        );
        
        // Update thread channels
        if (thread_channels) {
            await pool.query('DELETE FROM reply_thread_channels WHERE guild_id = $1', [guildId]);
            for (const channelId of thread_channels) {
                await pool.query(
                    'INSERT INTO reply_thread_channels (guild_id, channel_id) VALUES ($1, $2)',
                    [guildId, channelId]
                );
            }
        }
    },

    // Onboarding Settings
    async getOnboardingSettings(guildId) {
        const settingsResult = await pool.query(
            'SELECT * FROM onboarding_settings WHERE guild_id = $1',
            [guildId]
        );
        const categoriesResult = await pool.query(
            'SELECT * FROM onboarding_categories WHERE guild_id = $1 ORDER BY sort_order, name',
            [guildId]
        );
        const rolesResult = await pool.query(
            'SELECT r.*, c.name as category_name FROM onboarding_roles r LEFT JOIN onboarding_categories c ON r.category_id = c.id WHERE r.guild_id = $1 ORDER BY r.sort_order, r.role_id',
            [guildId]
        );
        
        return {
            settings: settingsResult.rows[0] || {},
            categories: categoriesResult.rows,
            roles: rolesResult.rows
        };
    },

    async setOnboardingSettings(guildId, data) {
        const { settings } = data;
        if (settings) {
            console.log('[Dashboard] Saving onboarding settings:', { guildId, settings });
            await pool.query(
                `INSERT INTO onboarding_settings (guild_id, enabled, gate_role_id, log_channel_id, welcome_channel_id)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (guild_id) DO UPDATE SET
                 enabled = EXCLUDED.enabled,
                 gate_role_id = EXCLUDED.gate_role_id, log_channel_id = EXCLUDED.log_channel_id,
                 welcome_channel_id = EXCLUDED.welcome_channel_id, updated_at = NOW()`,
                [guildId, settings.enabled ?? true, settings.gate_role_id, settings.log_channel_id, settings.welcome_channel_id]
            );
        }
    },

    async createOnboardingCategory(guildId, category) {
        const name = category?.name;
        if (!name) {
            throw new Error('Category name is required');
        }
        const description = category?.description ?? '';
        const emoji = category?.emoji ?? '';
        const selectionType = category?.selection_type ?? category?.selectionType ?? 'REQUIRED_ONE';
        const sortOrder = Number.isFinite(Number(category?.sort_order ?? category?.sortOrder))
            ? Number(category?.sort_order ?? category?.sortOrder)
            : 0;
        const enabled = category?.enabled ?? true;

        const result = await pool.query(
            `INSERT INTO onboarding_categories (guild_id, name, description, emoji, selection_type, sort_order, enabled, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (guild_id, name)
             DO UPDATE SET
                description = EXCLUDED.description,
                emoji = EXCLUDED.emoji,
                selection_type = EXCLUDED.selection_type,
                sort_order = EXCLUDED.sort_order,
                enabled = EXCLUDED.enabled,
                updated_at = NOW()
             RETURNING *`,
            [guildId, name, description, emoji, selectionType, sortOrder, enabled]
        );

        return result.rows[0];
    },

    async deleteOnboardingCategory(guildId, categoryId) {
        await pool.query(
            'DELETE FROM onboarding_categories WHERE guild_id = $1 AND id = $2',
            [guildId, categoryId]
        );
    },

    async updateOnboardingCategory(guildId, categoryId, updates) {
        const { name, description, emoji, selection_type, sort_order, enabled } = updates;
        const result = await pool.query(
            `UPDATE onboarding_categories
             SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                emoji = COALESCE($5, emoji),
                selection_type = COALESCE($6, selection_type),
                sort_order = COALESCE($7, sort_order),
                enabled = COALESCE($8, enabled),
                updated_at = NOW()
             WHERE guild_id = $1 AND id = $2
             RETURNING *`,
            [guildId, categoryId, name, description, emoji, selection_type, sort_order, enabled]
        );
        return result.rows[0];
    },

    async createOnboardingRole(guildId, role) {
        const categoryId = Number(role?.category_id ?? role?.categoryId);
        const roleId = role?.role_id ?? role?.roleId;
        const name = role?.name ?? role?.role_name ?? role?.roleName ?? null;
        const emoji = role?.emoji ?? '';
        const key = role?.key ?? null;
        const sortOrder = Number.isFinite(Number(role?.sort_order ?? role?.sortOrder))
            ? Number(role?.sort_order ?? role?.sortOrder)
            : 0;
        const enabled = role?.enabled ?? true;

        if (!Number.isFinite(categoryId)) {
            throw new Error('Role categoryId is required');
        }
        if (!roleId) {
            throw new Error('Role roleId is required');
        }
        if (!key) {
            throw new Error('Role key is required');
        }

        const result = await pool.query(
            `INSERT INTO onboarding_roles (guild_id, category_id, role_id, name, emoji, key, sort_order, enabled, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (guild_id, category_id, role_id)
             DO UPDATE SET
                name = EXCLUDED.name,
                emoji = EXCLUDED.emoji,
                key = EXCLUDED.key,
                sort_order = EXCLUDED.sort_order,
                enabled = EXCLUDED.enabled,
                updated_at = NOW()
             RETURNING *`,
            [guildId, categoryId, roleId, name, emoji, key, sortOrder, enabled]
        );

        return result.rows[0];
    },

    async deleteOnboardingRole(guildId, roleId) {
        await pool.query(
            'DELETE FROM onboarding_roles WHERE guild_id = $1 AND id = $2',
            [guildId, roleId]
        );
    },

    async updateOnboardingRole(guildId, roleId, updates) {
        const { name, emoji, key, sort_order, enabled, category_id, role_id } = updates;
        const result = await pool.query(
            `UPDATE onboarding_roles
             SET
                name = COALESCE($3, name),
                emoji = COALESCE($4, emoji),
                key = COALESCE($5, key),
                sort_order = COALESCE($6, sort_order),
                enabled = COALESCE($7, enabled),
                category_id = COALESCE($8, category_id),
                role_id = COALESCE($9, role_id),
                updated_at = NOW()
             WHERE guild_id = $1 AND id = $2
             RETURNING *`,
            [guildId, roleId, name, emoji, key, sort_order, enabled, category_id, role_id]
        );
        return result.rows[0];
    },

    // WoW Guild Settings
    async getWowGuildSettings(guildId) {
        const result = await pool.query(
            'SELECT * FROM wow_guild_settings WHERE guild_id = $1',
            [guildId]
        );
        return result.rows[0] || { enabled: true };
    },

    async setWowGuildSettings(guildId, settings) {
        const { enabled, onboarding_code, gate_role_id, wow_member_role_id, onboarding_channel_id, welcome_channel_id, log_channel_id, introduction_channel_id, welcome_message, code_prompt_message, invalid_code_message } = settings;
        await pool.query(
            `INSERT INTO wow_guild_settings (guild_id, enabled, onboarding_code, gate_role_id, wow_member_role_id, onboarding_channel_id, welcome_channel_id, log_channel_id, introduction_channel_id, welcome_message, code_prompt_message, invalid_code_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (guild_id) DO UPDATE SET
             enabled = EXCLUDED.enabled, onboarding_code = EXCLUDED.onboarding_code,
             gate_role_id = EXCLUDED.gate_role_id, wow_member_role_id = EXCLUDED.wow_member_role_id,
             onboarding_channel_id = EXCLUDED.onboarding_channel_id, welcome_channel_id = EXCLUDED.welcome_channel_id,
             log_channel_id = EXCLUDED.log_channel_id, introduction_channel_id = EXCLUDED.introduction_channel_id,
             welcome_message = EXCLUDED.welcome_message, code_prompt_message = EXCLUDED.code_prompt_message,
             invalid_code_message = EXCLUDED.invalid_code_message, updated_at = NOW()`,
            [guildId, enabled ?? true, onboarding_code, gate_role_id, wow_member_role_id, onboarding_channel_id, welcome_channel_id, log_channel_id, introduction_channel_id, welcome_message, code_prompt_message, invalid_code_message]
        );
    },

    // WoW Guest Settings
    async getWowGuestSettings(guildId) {
        const result = await pool.query(
            'SELECT * FROM wow_guest_settings WHERE guild_id = $1',
            [guildId]
        );
        return result.rows[0] || { enabled: true };
    },

    async setWowGuestSettings(guildId, settings) {
        const { enabled, gate_role_id, guest_role_id, onboarding_channel_id, welcome_channel_id, log_channel_id, introduction_channel_id, welcome_message, button_label } = settings;
        await pool.query(
            `INSERT INTO wow_guest_settings (guild_id, enabled, gate_role_id, guest_role_id, onboarding_channel_id, welcome_channel_id, log_channel_id, introduction_channel_id, welcome_message, button_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (guild_id) DO UPDATE SET
             enabled = EXCLUDED.enabled, gate_role_id = EXCLUDED.gate_role_id,
             guest_role_id = EXCLUDED.guest_role_id, onboarding_channel_id = EXCLUDED.onboarding_channel_id,
             welcome_channel_id = EXCLUDED.welcome_channel_id, log_channel_id = EXCLUDED.log_channel_id,
             introduction_channel_id = EXCLUDED.introduction_channel_id, welcome_message = EXCLUDED.welcome_message,
             button_label = EXCLUDED.button_label, updated_at = NOW()`,
            [guildId, enabled ?? true, gate_role_id, guest_role_id, onboarding_channel_id, welcome_channel_id, log_channel_id, introduction_channel_id, welcome_message, button_label]
        );
    }
};

const app = express();
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3001;

// ==================== MIDDLEWARE ====================

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"]
        },
    },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        usb: []
    }
}));

// CORS for local development
app.use(cors({
    origin: [`http://localhost:${PORT}`, 'http://127.0.0.1:' + PORT],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Login rate limiting (stricter)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: { error: 'Too many login attempts, please try again later.' }
});

app.use(express.json({ limit: '100kb' })); // Limit body size to prevent DoS
app.use(cookieParser());

// Attach a request id to every request for easier debugging
app.use((req, res, next) => {
    req.requestId = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-Id', req.requestId);
    next();
});

app.use(express.static(path.join(__dirname, 'dist')));

// ==================== AUTH MIDDLEWARE ====================

async function requireAuth(req, res, next) {
    const sessionToken = req.cookies.session;
    
    if (!sessionToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const session = await authDb.getSession(sessionToken);
        if (!session) {
            res.clearCookie('session');
            return res.status(401).json({ error: 'Session expired' });
        }
        
        req.user = {
            id: session.user_id,
            username: session.username,
            isAdmin: session.is_admin,
            discordId: session.discord_id
        };
        next();
    } catch (error) {
        console.error('[Dashboard] Auth error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Authentication error', requestId: req.requestId });
    }
}

async function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        const user = await authDb.getUserByUsername(username);
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await authDb.verifyPassword(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        const { sessionToken, expiresAt } = await authDb.createSession(user.id, ipAddress, userAgent);
        await authDb.updateUserLogin(user.id);
        
        res.cookie('session', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            expires: expiresAt
        });
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                isAdmin: user.is_admin
            }
        });
    } catch (error) {
        console.error('[Dashboard] Login error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Login failed', requestId: req.requestId });
    }
});

app.post('/api/auth/logout', async (req, res) => {
    const sessionToken = req.cookies.session;
    
    if (sessionToken) {
        await authDb.deleteSession(sessionToken).catch(() => {});
    }
    
    res.clearCookie('session');
    res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== USER MANAGEMENT (Admin only) ====================

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await authDb.getAllUsers();
        res.json({ users });
    } catch (error) {
        console.error('[Dashboard] Get users error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get users', requestId: req.requestId });
    }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, password, isAdmin } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        // Validate username format (alphanumeric, 3-32 chars)
        if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
            return res.status(400).json({ error: 'Username must be 3-32 alphanumeric characters' });
        }
        
        // Validate password strength
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
            return res.status(400).json({ error: passwordCheck.error });
        }
        
        const existingUser = await authDb.getUserByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        let user;
        if (isAdmin) {
            user = await authDb.createAdminUser(username, password);
        } else {
            user = await authDb.createLocalUser(username, password);
        }
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('[Dashboard] Create user error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to create user', requestId: req.requestId });
    }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        
        await authDb.deleteUserSessions(userId);
        await authDb.deleteUser(userId);
        
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Delete user error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to delete user', requestId: req.requestId });
    }
});

// ==================== GUILD ID VALIDATION MIDDLEWARE ====================

// Input validation helper - validates Discord snowflake IDs
function isValidSnowflake(id) {
    return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

// Middleware to validate guildId parameter for all guild routes
function validateGuildId(req, res, next) {
    const { guildId } = req.params;
    if (!isValidSnowflake(guildId)) {
        return res.status(400).json({ error: 'Invalid guild ID format' });
    }
    next();
}

// Middleware to validate and sanitize category/role data
function validateOnboardingCategory(category) {
    const errors = [];
    
    if (!category.name || typeof category.name !== 'string') {
        errors.push('Category name is required and must be a string');
    } else if (category.name.length > 100) {
        errors.push('Category name must be 100 characters or less');
    }
    
    if (category.description && typeof category.description !== 'string') {
        errors.push('Description must be a string');
    } else if (category.description?.length > 500) {
        errors.push('Description must be 500 characters or less');
    }
    
    if (category.emoji && typeof category.emoji !== 'string') {
        errors.push('Emoji must be a string');
    } else if (category.emoji?.length > 10) {
        errors.push('Emoji must be 10 characters or less');
    }
    
    const validSelectionTypes = ['REQUIRED_ONE', 'ONLY_ONE', 'MULTIPLE', 'NONE_OR_ONE', 'NONE_OR_MULTIPLE'];
    if (category.selection_type && !validSelectionTypes.includes(category.selection_type)) {
        errors.push(`Invalid selection_type. Must be one of: ${validSelectionTypes.join(', ')}`);
    }
    
    if (category.sort_order !== undefined && !Number.isFinite(Number(category.sort_order))) {
        errors.push('sort_order must be a number');
    }
    
    return errors;
}

function validateOnboardingRole(role) {
    const errors = [];
    
    if (!Number.isFinite(Number(role.category_id))) {
        errors.push('category_id is required and must be a number');
    }
    
    if (!role.role_id || !isValidSnowflake(role.role_id)) {
        errors.push('role_id is required and must be a valid Discord snowflake ID');
    }
    
    if (!role.key || typeof role.key !== 'string') {
        errors.push('key is required and must be a string');
    } else if (role.key.length > 50) {
        errors.push('key must be 50 characters or less');
    }
    
    if (role.name && typeof role.name !== 'string') {
        errors.push('name must be a string');
    } else if (role.name?.length > 100) {
        errors.push('name must be 100 characters or less');
    }
    
    if (role.emoji && typeof role.emoji !== 'string') {
        errors.push('emoji must be a string');
    } else if (role.emoji?.length > 10) {
        errors.push('emoji must be 10 characters or less');
    }
    
    if (role.sort_order !== undefined && !Number.isFinite(Number(role.sort_order))) {
        errors.push('sort_order must be a number');
    }
    
    return errors;
}

// ==================== GUILD SETTINGS ROUTES ====================

const DASHBOARD_GUILD_SETTINGS_KEYS = [
    // General
    'cmd_prefix', 'bot_enabled', 'bot_timezone', 'plan_tier',
    // Modules
    'enable_automod', 'enable_openAI', 'enable_leveling', 'enable_economy', 'enable_role_menus',
    'auto_role_enabled', 'auto_role_id',
    // Roles
    'roles_super_admin', 'roles_admin', 'roles_mod', 'roles_jr_mod', 'roles_helper', 'roles_trust', 'roles_untrusted',
    // Moderation
    'mute_roleID', 'mute_rolesRemoved', 'mute_immuneUserIDs',
    'kick_immuneRoles', 'kick_immuneUserID',
    'ban_immuneRoles', 'ban_immuneUserID',
    // Logging channels
    'ch_actionLog', 'ch_kickbanLog', 'ch_auditLog',
    'ch_airlockJoin', 'ch_airlockLeave', 'ch_deletedMessages',
    'ch_editedMessages', 'ch_automod_AI', 'ch_voiceLog',
    'ch_inviteLog', 'ch_permanentInvites', 'ch_memberJoin',
    // Logging enable flags (separate from channel selection)
    'enable_ch_actionLog', 'enable_ch_kickbanLog', 'enable_ch_auditLog',
    'enable_ch_airlockJoin', 'enable_ch_airlockLeave', 'enable_ch_deletedMessages',
    'enable_ch_editedMessages', 'enable_ch_automod_AI', 'enable_ch_voiceLog',
    'enable_ch_inviteLog', 'enable_ch_permanentInvites', 'enable_ch_memberJoin',
    // Automod ignore lists
    'ch_categoryIgnoreAutomod', 'ch_channelIgnoreAutomod'
];

const DASHBOARD_GUILD_SETTINGS_KEYS_SET = new Set(DASHBOARD_GUILD_SETTINGS_KEYS);

function normalizeGuildSettingsForClient(settingsRow) {
    if (!settingsRow || typeof settingsRow !== 'object') return {};

    // pg returns unquoted column identifiers as lower-case keys.
    // The dashboard frontend uses camelCase keys (e.g. ch_actionLog, mute_roleID).
    // Add those canonical keys alongside the raw row so reloads keep working.
    const normalized = { ...settingsRow };
    for (const key of DASHBOARD_GUILD_SETTINGS_KEYS) {
        if (normalized[key] !== undefined) continue;
        const lowerKey = key.toLowerCase();
        if (settingsRow[lowerKey] !== undefined) {
            normalized[key] = settingsRow[lowerKey];
        }
    }
    return normalized;
}

app.get('/api/guilds/:guildId/settings', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const settings = await getGuildSettings(guildId);
        res.json({ settings: normalizeGuildSettingsForClient(settings) });
    } catch (error) {
        console.error('[Dashboard] Get guild settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get guild settings', requestId: req.requestId });
    }
});

app.patch('/api/guilds/:guildId/settings', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const updates = req.body;
        
        // Whitelist allowed settings keys to prevent arbitrary column updates
        const allowedKeys = DASHBOARD_GUILD_SETTINGS_KEYS_SET;

        const jsonArrayKeys = new Set([
            'roles_super_admin', 'roles_admin', 'roles_mod', 'roles_jr_mod', 'roles_helper', 'roles_trust', 'roles_untrusted',
            'mute_rolesRemoved', 'mute_immuneUserIDs',
            'kick_immuneRoles', 'kick_immuneUserID',
            'ban_immuneRoles', 'ban_immuneUserID',
            'ch_categoryIgnoreAutomod', 'ch_channelIgnoreAutomod'
        ]);
        
        // Validate each update key and value
        for (const [key, value] of Object.entries(updates)) {
            if (!allowedKeys.has(key)) {
                return res.status(400).json({ error: `Invalid setting key: ${key}` });
            }

            // Allow null to clear settings.
            // For array-backed settings, treat null as an empty array.
            if (value === null) {
                const normalizedValue = jsonArrayKeys.has(key) ? [] : null;
                await updateGuildSetting(guildId, key, normalizedValue);
                continue;
            }
            
            // Normalize JSON array inputs
            let normalizedValue = value;
            if (jsonArrayKeys.has(key)) {
                if (Array.isArray(value)) {
                    // Validate snowflake-like items if they look like IDs
                    const normalizedArray = [];
                    for (const item of value) {
                        if (typeof item !== 'string') {
                            return res.status(400).json({ error: `Invalid array value for ${key}` });
                        }
                        const trimmed = item.trim();
                        if (trimmed && !isValidSnowflake(trimmed)) {
                            return res.status(400).json({ error: `Invalid Discord ID in ${key}` });
                        }
                        if (trimmed) normalizedArray.push(trimmed);
                    }
                    normalizedValue = normalizedArray;
                } else if (typeof value === 'string') {
                    // Accept raw JSON string
                    try {
                        const parsed = JSON.parse(value);
                        if (!Array.isArray(parsed)) {
                            return res.status(400).json({ error: `${key} must be an array` });
                        }

                        const normalizedArray = [];
                        for (const item of parsed) {
                            if (typeof item !== 'string') {
                                return res.status(400).json({ error: `Invalid array value for ${key}` });
                            }
                            const trimmed = item.trim();
                            if (trimmed && !isValidSnowflake(trimmed)) {
                                return res.status(400).json({ error: `Invalid Discord ID in ${key}` });
                            }
                            if (trimmed) normalizedArray.push(trimmed);
                        }

                        normalizedValue = normalizedArray;
                    } catch {
                        return res.status(400).json({ error: `${key} must be valid JSON array` });
                    }
                } else {
                    return res.status(400).json({ error: `${key} must be an array` });
                }
            }

            // Basic type validation
            if (typeof normalizedValue === 'string') {
                // Validate Discord IDs or channel/role prefixes
                if ((key.startsWith('ch_') || key.endsWith('_role') || key.endsWith('roleID') || key.endsWith('_id')) && normalizedValue.trim()) {
                    if (!isValidSnowflake(normalizedValue)) {
                        return res.status(400).json({ error: `Invalid Discord ID format for ${key}` });
                    }
                }
                // Limit prefix length
                if (key === 'cmd_prefix' && normalizedValue.length > 10) {
                    return res.status(400).json({ error: 'Command prefix too long (max 10 characters)' });
                }
                if (key === 'bot_timezone' && normalizedValue.length > 64) {
                    return res.status(400).json({ error: 'Timezone too long' });
                }
            } else if (jsonArrayKeys.has(key) && Array.isArray(normalizedValue)) {
                // OK
            } else if (typeof normalizedValue !== 'boolean' && typeof normalizedValue !== 'number') {
                return res.status(400).json({ error: `Invalid value type for ${key}` });
            }
            
            await updateGuildSetting(guildId, key, normalizedValue);
        }
        
        const settings = await getGuildSettings(guildId);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[Dashboard] Update guild settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update guild settings', requestId: req.requestId });
    }
});

// ==================== COMMAND TOGGLES ====================

app.get('/api/guilds/:guildId/commands', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;

        const result = await pool.query(
            `
            SELECT
                cr.command_name,
                cr.category,
                cr.has_slash,
                cr.has_prefix,
                COALESCE(gcs.enabled, TRUE) AS enabled
            FROM command_registry cr
            LEFT JOIN guild_command_settings gcs
                ON gcs.guild_id = $1
               AND gcs.command_name = cr.command_name
            ORDER BY COALESCE(cr.category, ''), cr.command_name
        `,
            [guildId]
        );

        // Group commands by category
        const grouped = {};
        const guildCommands = {};
        
        result.rows.forEach(cmd => {
            const category = cmd.category || 'uncategorized';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push({
                command_name: cmd.command_name,
                has_slash: cmd.has_slash,
                has_prefix: cmd.has_prefix
            });
            guildCommands[cmd.command_name] = cmd.enabled;
        });

        res.json({ commands: grouped, guildCommands });
    } catch (error) {
        console.error('[Dashboard] Get commands error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get commands', requestId: req.requestId });
    }
});

app.patch('/api/guilds/:guildId/commands/:commandName', requireAuth, async (req, res) => {
    try {
        const { guildId, commandName } = req.params;
        const { enabled } = req.body || {};

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be boolean' });
        }

        // Validate command exists
        const exists = await pool.query('SELECT 1 FROM command_registry WHERE command_name = $1', [commandName]);
        if (exists.rowCount === 0) {
            return res.status(404).json({ error: 'Unknown command' });
        }

        await pool.query(
            `
            INSERT INTO guild_command_settings (guild_id, command_name, enabled)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, command_name)
            DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
        `,
            [guildId, commandName, enabled]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Update command toggle error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update command', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/commands/:commandName', requireAuth, async (req, res) => {
    try {
        const { guildId, commandName } = req.params;
        const { enabled } = req.body || {};

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be boolean' });
        }

        // Validate command exists
        const exists = await pool.query('SELECT 1 FROM command_registry WHERE command_name = $1', [commandName]);
        if (exists.rowCount === 0) {
            return res.status(404).json({ error: 'Unknown command' });
        }

        await pool.query(
            `
            INSERT INTO guild_command_settings (guild_id, command_name, enabled)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, command_name)
            DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
        `,
            [guildId, commandName, enabled]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Update command toggle error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update command', requestId: req.requestId });
    }
});

// ==================== MODERATION DATA ====================

app.get('/api/guilds/:guildId/moderation/muted', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);

        const result = await pool.query(
            `
            SELECT
                mute_id,
                user_id,
                reason,
                actioned_by,
                recorded_at,
                expires_at,
                active
            FROM muted_users
            WHERE guild_id = $1
              AND active = TRUE
            ORDER BY recorded_at DESC
            LIMIT $2
        `,
            [guildId, limit]
        );

        res.json({ muted: result.rows });
    } catch (error) {
        console.error('[Dashboard] Get muted users error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get muted users', requestId: req.requestId });
    }
});

// ==================== DASHBOARD STATS ====================

app.get('/api/guilds/:guildId/stats', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        // guildId already validated by app.param() middleware
        
        // Sanitize and limit days parameter to prevent abuse
        const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
        
        // Get activity data (joins, leaves, messages per day)
        // SECURITY: Use parameterized query with make_interval() to prevent SQL injection
        const activityResult = await pool.query(`
            SELECT 
                date_trunc('day', created_at) as date,
                event_type,
                COUNT(*) as count
            FROM guild_events 
            WHERE guild_id = $1 
              AND created_at > NOW() - make_interval(days => $2)
            GROUP BY date_trunc('day', created_at), event_type
            ORDER BY date ASC
        `, [guildId, days]).catch(() => ({ rows: [] }));
        
        // Get moderation action counts
        const modResult = await pool.query(`
            SELECT action_type, COUNT(*) as count
            FROM moderation_logs 
            WHERE guild_id = $1 
              AND created_at > NOW() - make_interval(days => $2)
            GROUP BY action_type
        `, [guildId, days]).catch(() => ({ rows: [] }));
        
        // Get recent moderation actions
        const recentResult = await pool.query(`
            SELECT action_type as type, target_user_id as user, moderator_id as moderator, reason, created_at as timestamp
            FROM moderation_logs 
            WHERE guild_id = $1 
            ORDER BY created_at DESC
            LIMIT 10
        `, [guildId]).catch(() => ({ rows: [] }));
        
        // Get member stats
        const memberResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE joined_at::date = CURRENT_DATE) as joins_today,
                COUNT(*) FILTER (WHERE left_at::date = CURRENT_DATE) as leaves_today
            FROM member_tracking 
            WHERE guild_id = $1
        `, [guildId]).catch(() => ({ rows: [{}] }));
        
        // Get captcha kicks count
        const captchaResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM moderation_logs 
            WHERE guild_id = $1 
              AND action_type = 'captcha_kick'
              AND created_at > NOW() - make_interval(days => $2)
        `, [guildId, days]).catch(() => ({ rows: [{ count: 0 }] }));
        
        // Resolve guild timezone for graph label formatting
        const settings = await getGuildSettings(guildId);
        const botTimezone = settings?.bot_timezone || 'UTC';
        let labelFormatter;
        try {
            labelFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: botTimezone });
        } catch {
            labelFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        }

        // Build activity chart data
        const labels = [];
        const joins = [];
        const leaves = [];
        const messages = [];
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            labels.push(labelFormatter.format(date));
            
            const dayData = activityResult.rows.filter(r => 
                r.date && r.date.toISOString().split('T')[0] === dateStr
            );
            
            joins.push(parseInt(dayData.find(d => d.event_type === 'join')?.count) || 0);
            leaves.push(parseInt(dayData.find(d => d.event_type === 'leave')?.count) || 0);
            messages.push(parseInt(dayData.find(d => d.event_type === 'message')?.count) || 0);
        }
        
        // Build moderation breakdown
        const moderation = {
            bans: 0,
            kicks: 0,
            mutes: 0,
            warnings: 0
        };
        
        modResult.rows.forEach(row => {
            const type = row.action_type?.toLowerCase();
            if (type === 'ban') moderation.bans = parseInt(row.count);
            else if (type === 'kick' || type === 'captcha_kick') moderation.kicks += parseInt(row.count);
            else if (type === 'mute' || type === 'timeout') moderation.mutes = parseInt(row.count);
            else if (type === 'warn' || type === 'warning') moderation.warnings = parseInt(row.count);
        });
        
        res.json({
            totalMembers: 0, // Would need Discord API integration
            joinsToday: parseInt(memberResult.rows[0]?.joins_today) || 0,
            modActions7d: modResult.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
            captchaKicks: parseInt(captchaResult.rows[0]?.count) || 0,
            activity: { labels, joins, leaves, messages },
            moderation,
            recentActions: recentResult.rows
        });
    } catch (error) {
        console.error('[Dashboard] Get stats error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get stats', requestId: req.requestId });
    }
});

// ==================== AUTOMOD: NO ROLEPLAY ====================

app.get('/api/guilds/:guildId/automod/no-roleplay', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const settings = await automodSettings.getNoRoleplaySettings(guildId);
        res.json({ settings: settings || {} });
    } catch (error) {
        console.error('[Dashboard] Get no-roleplay settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get settings', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/automod/no-roleplay', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        await automodSettings.setNoRoleplaySettings(guildId, req.body);
        const settings = await automodSettings.getNoRoleplaySettings(guildId);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[Dashboard] Update no-roleplay settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update settings', requestId: req.requestId });
    }
});

// ==================== AUTOMOD: NO DANGER EDITS ====================

app.get('/api/guilds/:guildId/automod/no-danger-edits', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const settings = await automodSettings.getNoDangerEditsSettings(guildId);
        res.json({ settings: settings || {} });
    } catch (error) {
        console.error('[Dashboard] Get no-danger-edits settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get settings', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/automod/no-danger-edits', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        await automodSettings.setNoDangerEditsSettings(guildId, req.body);
        const settings = await automodSettings.getNoDangerEditsSettings(guildId);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[Dashboard] Update no-danger-edits settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update settings', requestId: req.requestId });
    }
});

// ==================== REPLY THREAD SETTINGS ====================

app.get('/api/guilds/:guildId/reply-thread', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const settings = await automodSettings.getReplyThreadSettings(guildId);
        res.json({ settings: settings || {} });
    } catch (error) {
        console.error('[Dashboard] Get reply-thread settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get settings', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/reply-thread', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        await automodSettings.setReplyThreadSettings(guildId, req.body);
        const settings = await automodSettings.getReplyThreadSettings(guildId);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[Dashboard] Update reply-thread settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update settings', requestId: req.requestId });
    }
});

app.get('/api/guilds/:guildId/reply-thread/channels', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const channels = await automodSettings.getReplyThreadChannels(guildId);
        res.json({ channels });
    } catch (error) {
        console.error('[Dashboard] Get reply-thread channels error:', error);
        res.status(500).json({ error: 'Failed to get channels' });
    }
});

app.put('/api/guilds/:guildId/reply-thread/channels/:channelId', requireAuth, async (req, res) => {
    try {
        const { guildId, channelId } = req.params;
        await automodSettings.setReplyThreadChannel(guildId, channelId, req.body);
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Update reply-thread channel error:', error);
        res.status(500).json({ error: 'Failed to update channel' });
    }
});

app.delete('/api/guilds/:guildId/reply-thread/channels/:channelId', requireAuth, async (req, res) => {
    try {
        const { guildId, channelId } = req.params;
        await automodSettings.deleteReplyThreadChannel(guildId, channelId);
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Delete reply-thread channel error:', error);
        res.status(500).json({ error: 'Failed to delete channel' });
    }
});

// ==================== ONBOARDING SETTINGS ====================

app.get('/api/guilds/:guildId/onboarding', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const data = await automodSettings.getOnboardingSettings(guildId);
        res.json({ data });
    } catch (error) {
        console.error('[Dashboard] Get onboarding settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get settings', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/onboarding', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        await automodSettings.setOnboardingSettings(guildId, req.body);
        const data = await automodSettings.getOnboardingSettings(guildId);
        res.json({ success: true, data });
    } catch (error) {
        console.error('[Dashboard] Update onboarding settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update settings', requestId: req.requestId });
    }
});

app.post('/api/guilds/:guildId/onboarding/categories', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        
        // Validate input
        const validationErrors = validateOnboardingCategory(req.body);
        if (validationErrors.length > 0) {
            return res.status(400).json({ error: validationErrors[0] });
        }
        
        const result = await automodSettings.createOnboardingCategory(guildId, req.body);
        res.json({ success: true, category: result });
    } catch (error) {
        console.error('[Dashboard] Create onboarding category error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to create category', requestId: req.requestId });
    }
});

app.delete('/api/guilds/:guildId/onboarding/categories/:categoryId', requireAuth, async (req, res) => {
    try {
        const { guildId, categoryId } = req.params;
        await automodSettings.deleteOnboardingCategory(guildId, parseInt(categoryId));
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Delete onboarding category error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to delete category', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/onboarding/categories/:categoryId', requireAuth, async (req, res) => {
    try {
        const { guildId, categoryId } = req.params;
        
        // Validate input
        const validationErrors = validateOnboardingCategory(req.body);
        if (validationErrors.length > 0) {
            return res.status(400).json({ error: validationErrors[0] });
        }
        
        const result = await automodSettings.updateOnboardingCategory(guildId, parseInt(categoryId), req.body);
        res.json({ success: true, category: result });
    } catch (error) {
        console.error('[Dashboard] Update onboarding category error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update category', requestId: req.requestId });
    }
});

app.post('/api/guilds/:guildId/onboarding/roles', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        
        // Validate input
        const validationErrors = validateOnboardingRole(req.body);
        if (validationErrors.length > 0) {
            return res.status(400).json({ error: validationErrors[0] });
        }
        
        const result = await automodSettings.createOnboardingRole(guildId, req.body);
        res.json({ success: true, role: result });
    } catch (error) {
        console.error('[Dashboard] Create onboarding role error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to create role', requestId: req.requestId });
    }
});

app.delete('/api/guilds/:guildId/onboarding/roles/:roleId', requireAuth, async (req, res) => {
    try {
        const { guildId, roleId } = req.params;
        await automodSettings.deleteOnboardingRole(guildId, parseInt(roleId));
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Delete onboarding role error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to delete role', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/onboarding/roles/:roleId', requireAuth, async (req, res) => {
    try {
        const { guildId, roleId } = req.params;
        
        // Validate input
        const validationErrors = validateOnboardingRole(req.body);
        if (validationErrors.length > 0) {
            return res.status(400).json({ error: validationErrors[0] });
        }
        
        const result = await automodSettings.updateOnboardingRole(guildId, parseInt(roleId), req.body);
        res.json({ success: true, role: result });
    } catch (error) {
        console.error('[Dashboard] Update onboarding role error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update role', requestId: req.requestId });
    }
});

// ==================== WOW GUILD SETTINGS ====================

app.get('/api/guilds/:guildId/wow-guild', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const settings = await automodSettings.getWowGuildSettings(guildId);
        res.json({ settings: settings || {} });
    } catch (error) {
        console.error('[Dashboard] Get wow-guild settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get settings', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/wow-guild', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        await automodSettings.setWowGuildSettings(guildId, req.body);
        const settings = await automodSettings.getWowGuildSettings(guildId);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[Dashboard] Update wow-guild settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update settings', requestId: req.requestId });
    }
});

// ==================== WOW GUEST SETTINGS ====================

app.get('/api/guilds/:guildId/wow-guest', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const settings = await automodSettings.getWowGuestSettings(guildId);
        res.json({ settings: settings || {} });
    } catch (error) {
        console.error('[Dashboard] Get wow-guest settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to get settings', requestId: req.requestId });
    }
});

app.put('/api/guilds/:guildId/wow-guest', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        await automodSettings.setWowGuestSettings(guildId, req.body);
        const settings = await automodSettings.getWowGuestSettings(guildId);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[Dashboard] Update wow-guest settings error:', { requestId: req.requestId, error });
        res.status(500).json({ error: 'Failed to update settings', requestId: req.requestId });
    }
});

// ==================== DISCORD API PROXY (DB CACHED) ====================

app.get('/api/discord/guild/:guildId/channels', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    
    // Validate guild ID format
    if (!isValidSnowflake(guildId)) {
        return res.status(400).json({ error: 'Invalid guild ID format' });
    }
    
    try {
        // Parameterized query to prevent SQL injection
        const result = await pool.query(
            'SELECT channel_id as id, name, type, position, parent_id FROM discord_channels WHERE guild_id = $1 ORDER BY type, position',
            [guildId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('[Dashboard] Error fetching channels from DB:', error);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

app.get('/api/discord/guild/:guildId/roles', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    
    // Validate guild ID format
    if (!isValidSnowflake(guildId)) {
        return res.status(400).json({ error: 'Invalid guild ID format' });
    }
    
    try {
        // Try fetching from DB first
        let result = await pool.query(
            'SELECT role_id as id, name, color, position, permissions, managed FROM discord_roles WHERE guild_id = $1 ORDER BY position DESC',
            [guildId]
        );

        // If no roles found or explicit refresh requested (optional logic), fetch from Discord API
        // For now, let's always fetch from API if we have the token, to ensure freshness as requested
        // But to be efficient, we can only do it if DB is empty or user requests it.
        // The user complained about colors not updating, so let's FORCE a sync here or fetch directly.
        // Fetching directly and returning is safer for "correctness".
        
        if (process.env.DISCORD_TOKEN) {
             try {
                const apiRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
                    headers: {
                        Authorization: `Bot ${process.env.DISCORD_TOKEN}`
                    }
                });
                
                // Map API response to expected format
                const apiRoles = apiRes.data.map(r => ({
                    id: r.id,
                    name: r.name,
                    color: r.color,
                    position: r.position,
                    permissions: r.permissions,
                    managed: r.managed
                })).sort((a, b) => b.position - a.position);

                // Asynchronously update DB to keep it in sync (fire and forget)
                // We don't await this to keep response fast, or do we? 
                // Let's await to ensure no race conditions if multiple requests come in.
                // Or better: just replace the DB content.
                // Note: This matches the "pull from Discord API" request.
                
                (async () => {
                   for (const role of apiRoles) {
                       try {
                           await pool.query(
                               `INSERT INTO discord_roles (role_id, guild_id, name, color, position, permissions, managed)
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                ON CONFLICT (role_id) DO UPDATE SET
                                name = EXCLUDED.name, color = EXCLUDED.color, position = EXCLUDED.position,
                                permissions = EXCLUDED.permissions, managed = EXCLUDED.managed, last_updated = NOW()`,
                               [role.id, guildId, role.name, role.color, role.position, role.permissions, role.managed]
                           );
                       } catch (err) {
                           console.error('Error upserting role during API fetch:', err);
                       }
                   }
                })();

                return res.json(apiRoles);
            } catch (apiError) {
                console.error('[Dashboard] Error fetching roles from Discord API:', apiError.message);
                // Fallback to DB if API fails
            }
        }

        res.json(result.rows);
    } catch (error) {
        console.error('[Dashboard] Error fetching roles from DB:', error);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

app.get('/api/discord/guild/:guildId/bot-member', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    if (!isValidSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guild ID' });

    try {
        if (process.env.DISCORD_TOKEN) {
            const apiRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
            });
            return res.json(apiRes.data);
        }
        res.status(503).json({ error: 'Discord token not available' });
    } catch (error) {
        if (error.response && [400, 403, 404].includes(error.response.status)) {
            // Expected error if bot is not in guild or ID is invalid
            return res.status(error.response.status).json({ error: 'Bot not found in guild' });
        }
        console.error('[Dashboard] Error fetching bot member:', error.message);
        res.status(500).json({ error: 'Failed to fetch bot member' });
    }
});


// ==================== ACTIVITY DASHBOARD API ====================

// Get activity overview for dashboard
app.get('/api/guilds/:guildId/activity', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        
        // Get messages in last 24h
        const messagesResult = await pool.query(
            `SELECT COALESCE(SUM(message_count), 0)::int as count
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '1 day'`,
            [guildId]
        );
        
        // Get active members today (who sent at least one message)
        const activeMembersResult = await pool.query(
            `SELECT COUNT(DISTINCT user_id)::int as count
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE AND message_count > 0`,
            [guildId]
        );
        
        // Get voice minutes today
        const voiceResult = await pool.query(
            `SELECT COALESCE(SUM(vc_minutes), 0)::int as count
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE`,
            [guildId]
        );
        
        // Get top channels by message count in last 7 days
        const topChannelsResult = await pool.query(
            `SELECT channel_id, COUNT(*)::int as message_count
             FROM guild_events
             WHERE guild_id = $1 
               AND event_type = 'message' 
               AND created_at >= NOW() - INTERVAL '7 days'
             GROUP BY channel_id
             ORDER BY message_count DESC
             LIMIT 5`,
            [guildId]
        );
        
        res.json({
            messagesLast24h: messagesResult.rows[0]?.count || 0,
            activeMembersToday: activeMembersResult.rows[0]?.count || 0,
            voiceMinutesToday: voiceResult.rows[0]?.count || 0,
            topChannels: topChannelsResult.rows
        });
    } catch (error) {
        console.error('[Dashboard] Error fetching activity overview:', error);
        res.status(500).json({ error: 'Failed to fetch activity overview' });
    }
});

// Get activity stats for a guild
app.get('/api/guilds/:guildId/activity/stats', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const days = parseInt(req.query.days) || 90;
        
        // Get daily activity data
        const activityResult = await pool.query(
            `SELECT date, joins_count, leaves_count
             FROM daily_stats
             WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
             ORDER BY date ASC`,
            [guildId]
        );
        
        // Get message stats
        const messageResult = await pool.query(
            `SELECT stat_date as date, SUM(message_count)::int as messages_count
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'
             GROUP BY stat_date
             ORDER BY stat_date ASC`,
            [guildId]
        );
        
        // Get voice stats
        const voiceResult = await pool.query(
            `SELECT stat_date as date, SUM(vc_minutes)::int as vc_minutes
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'
             GROUP BY stat_date
             ORDER BY stat_date ASC`,
            [guildId]
        );
        
        // Merge data by date
        const dateMap = new Map();
        
        activityResult.rows.forEach(row => {
            const d = row.date.toISOString().split('T')[0];
            dateMap.set(d, { date: d, joins: row.joins_count || 0, leaves: row.leaves_count || 0, messages: 0, voice_minutes: 0 });
        });
        
        messageResult.rows.forEach(row => {
            const d = new Date(row.date).toISOString().split('T')[0];
            if (dateMap.has(d)) {
                dateMap.get(d).messages = row.messages_count || 0;
            } else {
                dateMap.set(d, { date: d, joins: 0, leaves: 0, messages: row.messages_count || 0, voice_minutes: 0 });
            }
        });
        
        voiceResult.rows.forEach(row => {
            const d = new Date(row.date).toISOString().split('T')[0];
            if (dateMap.has(d)) {
                dateMap.get(d).voice_minutes = row.vc_minutes || 0;
            } else {
                dateMap.set(d, { date: d, joins: 0, leaves: 0, messages: 0, voice_minutes: row.vc_minutes || 0 });
            }
        });
        
        const activity = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
        
        res.json({ activity });
    } catch (error) {
        console.error('[Dashboard] Error fetching activity stats:', error);
        res.status(500).json({ error: 'Failed to fetch activity stats' });
    }
});

// Get top members by message activity
app.get('/api/guilds/:guildId/activity/top-messages', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const days = parseInt(req.query.days) || 90;
        const limit = parseInt(req.query.limit) || 20;
        
        const result = await pool.query(
            `SELECT user_id, SUM(message_count)::int as total_messages
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'
             GROUP BY user_id
             ORDER BY total_messages DESC
             LIMIT $2`,
            [guildId, limit]
        );
        
        res.json({ members: result.rows });
    } catch (error) {
        console.error('[Dashboard] Error fetching top messages:', error);
        res.status(500).json({ error: 'Failed to fetch top messages' });
    }
});

// Get top members by voice activity
app.get('/api/guilds/:guildId/activity/top-voice', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const days = parseInt(req.query.days) || 90;
        const limit = parseInt(req.query.limit) || 20;
        
        const result = await pool.query(
            `SELECT user_id, SUM(vc_minutes)::int as total_minutes
             FROM member_daily_stats
             WHERE guild_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'
             GROUP BY user_id
             ORDER BY total_minutes DESC
             LIMIT $2`,
            [guildId, limit]
        );
        
        res.json({ members: result.rows });
    } catch (error) {
        console.error('[Dashboard] Error fetching top voice:', error);
        res.status(500).json({ error: 'Failed to fetch top voice' });
    }
});

// ==================== LEVELING DASHBOARD API ====================

// Get leveling leaderboard
app.get('/api/guilds/:guildId/leveling/leaderboard', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        const result = await pool.query(
            `SELECT user_id, msg_exp, voice_exp, level, (msg_exp + voice_exp) as total_exp
             FROM member_leveling
             WHERE guild_id = $1
             ORDER BY total_exp DESC
             LIMIT $2`,
            [guildId, limit]
        );
        
        res.json({ leaderboard: result.rows });
    } catch (error) {
        console.error('[Dashboard] Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Get guild leveling configuration
app.get('/api/guilds/:guildId/leveling/config', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        
        const result = await pool.query(
            `SELECT * FROM guild_activity_config WHERE guild_id = $1`,
            [guildId]
        );
        
        if (result.rows.length === 0) {
            // Create default config
            const defaultResult = await pool.query(
                `INSERT INTO guild_activity_config (guild_id)
                 VALUES ($1)
                 RETURNING *`,
                [guildId]
            );
            res.json({ config: defaultResult.rows[0] });
        } else {
            res.json({ config: result.rows[0] });
        }
    } catch (error) {
        console.error('[Dashboard] Error fetching leveling config:', error);
        res.status(500).json({ error: 'Failed to fetch leveling config' });
    }
});

// Update guild leveling configuration
app.post('/api/guilds/:guildId/leveling/config', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const updates = req.body;
        
        // Validate fields
        const allowedFields = [
            'rolling_period_days', 'anti_spam_level', 'exclude_muted', 
            'exclude_deafened', 'exclude_bots', 'excluded_message_channels',
            'excluded_voice_channels', 'remove_previous_role'
        ];
        
        const fields = [];
        const values = [guildId];
        let paramCount = 2;
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = $${paramCount}`);
                values.push(value);
                paramCount++;
            }
        }
        
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        await pool.query(
            `INSERT INTO guild_activity_config (guild_id, ${Object.keys(updates).filter(k => allowedFields.includes(k)).join(', ')})
             VALUES ($1, ${Object.values(updates).filter((v, i) => allowedFields.includes(Object.keys(updates)[i])).map((_, i) => `$${i + 2}`).join(', ')})
             ON CONFLICT (guild_id)
             DO UPDATE SET ${fields.join(', ')}, updated_at = NOW()`,
            values
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Error updating leveling config:', error);
        res.status(500).json({ error: 'Failed to update leveling config' });
    }
});

// Get leveling roles
app.get('/api/guilds/:guildId/leveling/roles', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        
        const result = await pool.query(
            `SELECT * FROM leveling_roles
             WHERE guild_id = $1
             ORDER BY position ASC`,
            [guildId]
        );
        
        res.json({ roles: result.rows });
    } catch (error) {
        console.error('[Dashboard] Error fetching leveling roles:', error);
        res.status(500).json({ error: 'Failed to fetch leveling roles' });
    }
});

// Add or update leveling role
app.post('/api/guilds/:guildId/leveling/roles', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const { role_id, msg_exp_requirement, voice_exp_requirement, logic_operator, rolling_period_days, position } = req.body;
        
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
            [guildId, role_id, msg_exp_requirement || 0, voice_exp_requirement || 0, logic_operator || 'OR', rolling_period_days || 90, position || 0]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Error adding leveling role:', error);
        res.status(500).json({ error: 'Failed to add leveling role' });
    }
});

// Delete leveling role
app.delete('/api/guilds/:guildId/leveling/roles/:roleId', requireAuth, async (req, res) => {
    try {
        const { guildId, roleId } = req.params;
        
        await pool.query(
            `DELETE FROM leveling_roles
             WHERE guild_id = $1 AND role_id = $2`,
            [guildId, roleId]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Error deleting leveling role:', error);
        res.status(500).json({ error: 'Failed to delete leveling role' });
    }
});

// ==================== SERVE FRONTEND ====================

// ==================== ERROR HANDLER ====================

app.use((err, req, res, next) => {
    console.error('[Dashboard] Error:', { requestId: req.requestId, err });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});

// Serve index.html for all other routes to support SPA client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ==================== START SERVER ====================

async function startDashboard() {
    try {
        await ensureDashboardSchema();
        await ensureOnboardingSchema();

        // Initialize default admin user if none exists
        const users = await authDb.getAllUsers();
        if (users.length === 0) {
            // SECURITY: Require password from environment variable, do not use hardcoded default
            const defaultPassword = process.env.DASHBOARD_ADMIN_PASSWORD;
            
            if (!defaultPassword) {
                // Generate a secure random password if none provided
                const generatedPassword = crypto.randomBytes(16).toString('base64').slice(0, 20) + '!A1';
                await authDb.createAdminUser('admin', generatedPassword);
                console.log('[Dashboard] ========================================');
                console.log('[Dashboard] Created default admin user (username: admin)');
                console.log(`[Dashboard] Generated password: ${generatedPassword}`);
                console.log('[Dashboard] ⚠️  SAVE THIS PASSWORD! It will not be shown again.');
                console.log('[Dashboard] ⚠️  Set DASHBOARD_ADMIN_PASSWORD env var in production!');
                console.log('[Dashboard] ========================================');
            } else {
                // Validate provided password meets requirements
                const passwordCheck = validatePassword(defaultPassword);
                if (!passwordCheck.valid) {
                    console.error('[Dashboard] DASHBOARD_ADMIN_PASSWORD does not meet security requirements:');
                    console.error(`[Dashboard] ${passwordCheck.error}`);
                    process.exit(1);
                }
                await authDb.createAdminUser('admin', defaultPassword);
                console.log('[Dashboard] Created admin user from DASHBOARD_ADMIN_PASSWORD');
            }
        }
        
        app.listen(PORT, () => {
            console.log(`[Dashboard] Server running at http://localhost:${PORT}`);
            console.log(`[Dashboard] Login with your credentials to manage bot settings`);
        });
    } catch (error) {
        console.error('[Dashboard] Failed to start:', error);
        process.exit(1);
    }
}

// Export for potential integration with main bot
module.exports = { app, startDashboard };

// Start if run directly
if (require.main === module) {
    startDashboard();
}
