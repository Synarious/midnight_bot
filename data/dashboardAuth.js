/**
 * Dashboard Authentication Database Functions
 */

const crypto = require('crypto');
const { query, ensureSchemaReady } = require('./database');

// ==================== PASSWORD HASHING ====================

async function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            resolve(`${salt}:${derivedKey.toString('hex')}`);
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

// ==================== USER MANAGEMENT ====================

async function createLocalUser(username, password) {
    await ensureSchemaReady();
    
    const passwordHash = await hashPassword(password);
    
    const { rows } = await query(
        `INSERT INTO dashboard_users (username, password_hash, is_local_user, is_admin, created_at, updated_at)
         VALUES ($1, $2, TRUE, FALSE, NOW(), NOW())
         ON CONFLICT (username) DO NOTHING
         RETURNING id, username, is_admin`,
        [username, passwordHash],
        { context: 'createLocalUser' }
    );
    
    return rows[0] || null;
}

async function createAdminUser(username, password) {
    await ensureSchemaReady();
    
    const passwordHash = await hashPassword(password);
    
    const { rows } = await query(
        `INSERT INTO dashboard_users (username, password_hash, is_local_user, is_admin, created_at, updated_at)
         VALUES ($1, $2, TRUE, TRUE, NOW(), NOW())
         ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            is_admin = TRUE,
            updated_at = NOW()
         RETURNING id, username, is_admin`,
        [username, passwordHash],
        { context: 'createAdminUser' }
    );
    
    return rows[0];
}

async function getUserByUsername(username) {
    await ensureSchemaReady();
    
    const { rows } = await query(
        'SELECT * FROM dashboard_users WHERE username = $1',
        [username],
        { context: 'getUserByUsername' }
    );
    
    return rows[0] || null;
}

async function getUserById(userId) {
    await ensureSchemaReady();
    
    const { rows } = await query(
        'SELECT * FROM dashboard_users WHERE id = $1',
        [userId],
        { context: 'getUserById' }
    );
    
    return rows[0] || null;
}

async function getUserByDiscordId(discordId) {
    await ensureSchemaReady();
    
    const { rows } = await query(
        'SELECT * FROM dashboard_users WHERE discord_id = $1',
        [discordId],
        { context: 'getUserByDiscordId' }
    );
    
    return rows[0] || null;
}

async function updateUserLogin(userId) {
    await ensureSchemaReady();
    
    await query(
        'UPDATE dashboard_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
        [userId],
        { context: 'updateUserLogin' }
    );
}

async function getAllUsers() {
    await ensureSchemaReady();
    
    const { rows } = await query(
        'SELECT id, username, discord_id, is_local_user, is_admin, created_at, last_login_at FROM dashboard_users ORDER BY username',
        [],
        { context: 'getAllUsers' }
    );
    
    return rows;
}

async function deleteUser(userId) {
    await ensureSchemaReady();
    
    await query(
        'DELETE FROM dashboard_users WHERE id = $1',
        [userId],
        { context: 'deleteUser' }
    );
}

async function updateUserPassword(userId, newPassword) {
    await ensureSchemaReady();
    
    const passwordHash = await hashPassword(newPassword);
    
    await query(
        'UPDATE dashboard_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, userId],
        { context: 'updateUserPassword' }
    );
}

// ==================== SESSION MANAGEMENT ====================

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function createSession(userId, ipAddress = null, userAgent = null) {
    await ensureSchemaReady();
    
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    await query(
        `INSERT INTO dashboard_sessions (session_token, user_id, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionToken, userId, expiresAt, ipAddress, userAgent],
        { context: 'createSession' }
    );
    
    return { sessionToken, expiresAt };
}

async function getSession(sessionToken) {
    await ensureSchemaReady();
    
    const { rows } = await query(
        `SELECT s.*, u.username, u.is_admin, u.discord_id
         FROM dashboard_sessions s
         JOIN dashboard_users u ON s.user_id = u.id
         WHERE s.session_token = $1 AND s.expires_at > NOW()`,
        [sessionToken],
        { context: 'getSession' }
    );
    
    return rows[0] || null;
}

async function deleteSession(sessionToken) {
    await ensureSchemaReady();
    
    await query(
        'DELETE FROM dashboard_sessions WHERE session_token = $1',
        [sessionToken],
        { context: 'deleteSession' }
    );
}

async function deleteUserSessions(userId) {
    await ensureSchemaReady();
    
    await query(
        'DELETE FROM dashboard_sessions WHERE user_id = $1',
        [userId],
        { context: 'deleteUserSessions' }
    );
}

async function cleanupExpiredSessions() {
    await ensureSchemaReady();
    
    const { rowCount } = await query(
        'DELETE FROM dashboard_sessions WHERE expires_at <= NOW()',
        [],
        { context: 'cleanupExpiredSessions' }
    );
    
    return rowCount;
}

// ==================== GUILD PERMISSIONS ====================

async function setUserGuildPermission(userId, guildId, permissionLevel) {
    await ensureSchemaReady();
    
    await query(
        `INSERT INTO dashboard_guild_permissions (user_id, guild_id, permission_level, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, guild_id) DO UPDATE SET
            permission_level = EXCLUDED.permission_level,
            updated_at = NOW()`,
        [userId, guildId, permissionLevel],
        { context: 'setUserGuildPermission' }
    );
}

async function getUserGuildPermissions(userId) {
    await ensureSchemaReady();
    
    const { rows } = await query(
        'SELECT * FROM dashboard_guild_permissions WHERE user_id = $1',
        [userId],
        { context: 'getUserGuildPermissions' }
    );
    
    return rows;
}

async function getUserGuildPermission(userId, guildId) {
    await ensureSchemaReady();
    
    const { rows } = await query(
        'SELECT * FROM dashboard_guild_permissions WHERE user_id = $1 AND guild_id = $2',
        [userId, guildId],
        { context: 'getUserGuildPermission' }
    );
    
    return rows[0] || null;
}

async function deleteUserGuildPermission(userId, guildId) {
    await ensureSchemaReady();
    
    await query(
        'DELETE FROM dashboard_guild_permissions WHERE user_id = $1 AND guild_id = $2',
        [userId, guildId],
        { context: 'deleteUserGuildPermission' }
    );
}

// ==================== EXPORTS ====================

module.exports = {
    // Password helpers
    hashPassword,
    verifyPassword,
    
    // User management
    createLocalUser,
    createAdminUser,
    getUserByUsername,
    getUserById,
    getUserByDiscordId,
    updateUserLogin,
    getAllUsers,
    deleteUser,
    updateUserPassword,
    
    // Session management
    generateSessionToken,
    createSession,
    getSession,
    deleteSession,
    deleteUserSessions,
    cleanupExpiredSessions,
    
    // Guild permissions
    setUserGuildPermission,
    getUserGuildPermissions,
    getUserGuildPermission,
    deleteUserGuildPermission,
};
