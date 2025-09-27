require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(); // Uses .env values by default

console.log('[INFO] [Database] Successfully connected to PostgreSQL.');

const GUILD_SETTINGS_COLUMNS = {
  guild_id: "TEXT PRIMARY KEY",
  cmd_prefix: "TEXT DEFAULT '!'",
  bot_enabled: 'BOOLEAN DEFAULT TRUE',
  roles_super_admin: "TEXT DEFAULT '[]'",
  roles_admin: "TEXT DEFAULT '[]'",
  roles_mod: "TEXT DEFAULT '[]'",
  roles_jr_mod: "TEXT DEFAULT '[]'",
  roles_helper: "TEXT DEFAULT '[]'",
  roles_trust: "TEXT DEFAULT '[]'",
  roles_untrusted: "TEXT DEFAULT '[]'",
  enable_automod: 'BOOLEAN DEFAULT TRUE',
  enable_openAI: 'BOOLEAN DEFAULT TRUE',
  mute_roleID: 'TEXT',
  mute_rolesRemoved: "TEXT DEFAULT '[]'",
  mute_immuneUserIDs: "TEXT DEFAULT '[]'",
  kick_immuneRoles: "TEXT DEFAULT '[]'",
  kick_immuneUserID: "TEXT DEFAULT '[]'",
  ban_immuneRoles: "TEXT DEFAULT '[]'",
  ban_immuneUserID: "TEXT DEFAULT '[]'",
  ch_actionLog: 'TEXT',
  ch_kickbanLog: 'TEXT',
  ch_auditLog: 'TEXT',
  ch_airlockJoin: 'TEXT',
  ch_airlockLeave: 'TEXT',
  ch_deletedMessages: 'TEXT',
  ch_editedMessages: 'TEXT',
  ch_automod_AI: 'TEXT',
  ch_voiceLog: 'TEXT',
  ch_categoryIgnoreAutomod: "TEXT DEFAULT '[]'",
  ch_channelIgnoreAutomod: "TEXT DEFAULT '[]'",
  ch_inviteLog: 'TEXT',
  ch_permanentInvites: 'TEXT',
  ch_memberJoin: 'TEXT'
};

const TABLE_DEFINITIONS = [
  `CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    cmd_prefix TEXT DEFAULT '!',
    bot_enabled BOOLEAN DEFAULT TRUE,
    roles_super_admin TEXT DEFAULT '[]',
    roles_admin TEXT DEFAULT '[]',
    roles_mod TEXT DEFAULT '[]',
    roles_jr_mod TEXT DEFAULT '[]',
    roles_helper TEXT DEFAULT '[]',
    roles_trust TEXT DEFAULT '[]',
    roles_untrusted TEXT DEFAULT '[]',
    enable_automod BOOLEAN DEFAULT TRUE,
    enable_openAI BOOLEAN DEFAULT TRUE,
    mute_roleID TEXT,
    mute_rolesRemoved TEXT DEFAULT '[]',
    mute_immuneUserIDs TEXT DEFAULT '[]',
    kick_immuneRoles TEXT DEFAULT '[]',
    kick_immuneUserID TEXT DEFAULT '[]',
    ban_immuneRoles TEXT DEFAULT '[]',
    ban_immuneUserID TEXT DEFAULT '[]',
    ch_actionLog TEXT,
    ch_kickbanLog TEXT,
    ch_auditLog TEXT,
    ch_airlockJoin TEXT,
    ch_airlockLeave TEXT,
    ch_deletedMessages TEXT,
    ch_editedMessages TEXT,
    ch_automod_AI TEXT,
    ch_voiceLog TEXT,
    ch_categoryIgnoreAutomod TEXT DEFAULT '[]',
    ch_channelIgnoreAutomod TEXT DEFAULT '[]',
    ch_inviteLog TEXT,
    ch_permanentInvites TEXT,
    ch_memberJoin TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS filtered_messages (
    fmsg_ID SERIAL PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    message_id TEXT,
    channel_id TEXT,
    timestamp TEXT,
    hate INTEGER,
    harassment INTEGER,
    self_harm INTEGER,
    sexual INTEGER,
    violence INTEGER,
    content TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS muted_users (
    mute_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    active BOOLEAN,
    reason TEXT,
    roles TEXT,
    actioned_by TEXT,
    length TEXT,
    expires TEXT,
    timestamp TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS user_info (
    instance SERIAL PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    messages TEXT,
    ai_hate INTEGER,
    ai_harassment INTEGER,
    ai_self_harm INTEGER,
    ai_sexual INTEGER,
    ai_violence INTEGER,
    safety_hate INTEGER,
    safety_sexual INTEGER,
    safety_topicsPolitical INTEGER,
    safety_topicsUncomfortable INTEGER,
    banned INTEGER,
    kicked INTEGER,
    warned INTEGER,
    muted INTEGER,
    timeout INTEGER,
    ignore BOOLEAN DEFAULT FALSE,
    timestamp TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS invite_log (
    log_id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT,
    utc_time TIMESTAMP NOT NULL,
    invite_code TEXT NOT NULL,
    invite_creator TEXT NOT NULL,
    creator_id TEXT NOT NULL DEFAULT '',
    creator_name TEXT NOT NULL DEFAULT '',
    channel_id TEXT NOT NULL DEFAULT '',
    channel_name TEXT NOT NULL DEFAULT '',
    max_uses INTEGER DEFAULT 0,
    temporary BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP,
    uses_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`
];

async function ensureColumns(client, tableName, expectedColumns) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [tableName.toLowerCase()]
  );
  const existing = new Set(rows.map(row => row.column_name.toLowerCase()));

  for (const [columnName, definition] of Object.entries(expectedColumns)) {
    if (!existing.has(columnName.toLowerCase())) {
      const safeColumn = columnName;
      const alterStatement = `ALTER TABLE ${tableName} ADD COLUMN ${safeColumn} ${definition};`;
      await client.query(alterStatement);
      console.log(`[INFO] [Database] Added missing column "${safeColumn}" to ${tableName}.`);
    }
  }
}

async function ensureSchema() {
  const client = await pool.connect();
  try {
    for (const statement of TABLE_DEFINITIONS) {
      await client.query(statement);
    }

    await ensureColumns(client, 'guild_settings', GUILD_SETTINGS_COLUMNS);
  } catch (error) {
    console.error('[ERROR] [Database] Failed to ensure schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

const schemaReady = ensureSchema();

async function ensureSchemaReady() {
  return schemaReady;
}

// A whitelist of columns that are allowed to be updated by the setup command.
// This is a security measure to prevent updating sensitive or structural columns like 'guild_id'.
const updatableColumns = new Set([
    'cmd_prefix', 'bot_enabled', 'roles_super_admin', 'roles_admin', 'roles_mod', 
    'roles_jr_mod', 'roles_helper', 'roles_trust', 'roles_untrusted', 'enable_automod', 
    'enable_openAI', 'mute_roleID', 'mute_rolesRemoved', 'mute_immuneUserIDs', 
    'kick_immuneRoles', 'kick_immuneUserID', 'ban_immuneRoles', 'ban_immuneUserID', 
    'ch_actionLog', 'ch_kickbanLog', 'ch_auditLog', 'ch_airlockJoin', 'ch_airlockLeave', 
    'ch_deletedMessages', 'ch_editedMessages', 'ch_automod_AI', 'ch_voiceLog', 
    'ch_categoryIgnoreAutomod', 'ch_channelIgnoreAutomod', 'ch_inviteLog', 
    'ch_permanentInvites', 'ch_memberJoin'
]);

// === Functions ===

/**
 * Dynamically updates a specific setting for a guild.
 * @param {string} guildId The ID of the guild to update.
 * @param {string} column The name of the column in guild_settings to update.
 * @param {string|boolean|number} value The new value for the setting.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function updateGuildSetting(guildId, column, value) {
  await ensureSchemaReady();
  // Security: Ensure the column is in our whitelist of updatable columns.
  if (!updatableColumns.has(column)) {
    console.error(`[SECURITY] Blocked attempt to update non-whitelisted column: ${column}`);
    throw new Error('Invalid setting key.');
  }

  try {
    // The 'format' function from 'pg-format' is the safest way to handle dynamic identifiers.
    // However, since we are using a strict whitelist, direct interpolation is safe here.
    const query = `
      INSERT INTO guild_settings (guild_id, ${column})
      VALUES ($1, $2)
      ON CONFLICT (guild_id)
      DO UPDATE SET ${column} = EXCLUDED.${column};
    `;
    await pool.query(query, [guildId, value]);
    return true;
  } catch (error) {
    console.error(`[ERROR] [Database] Failed to update setting '${column}' for guild ${guildId}:`, error);
    return false;
  }
}


async function getLogChannelId(guildId) {
  await ensureSchemaReady();
  const res = await pool.query(
    'SELECT ch_automod_AI FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_automod_ai || null;
}

async function getVoiceLogChannelId(guildId) {
  await ensureSchemaReady();
  const res = await pool.query(
    'SELECT ch_voicelog FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_voicelog || null;
}

async function getJoinChannelId(guildId) {
  await ensureSchemaReady();
  const res = await pool.query(
    'SELECT ch_airlockJoin FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_airlockjoin || null;
}

async function getLeaveChannelId(guildId) {
  await ensureSchemaReady();
  const res = await pool.query(
    'SELECT ch_airlockLeave FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_airlockleave || null;
}

async function isOpenAIEnabled(guildId) {
  await ensureSchemaReady();
  const res = await pool.query(
    'SELECT enable_openAI FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.enable_openai === true;
}

async function setLogChannelId(guildId, logChannelId) {
  await ensureSchemaReady();
  await pool.query(`
    INSERT INTO guild_settings (guild_id, ch_automod_AI)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET ch_automod_AI = EXCLUDED.ch_automod_AI;
  `, [guildId, logChannelId]);
}

async function setGuildPrefix(guildId, prefix) {
  await ensureSchemaReady();
  await pool.query(`
    INSERT INTO guild_settings (guild_id, cmd_prefix)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET cmd_prefix = EXCLUDED.cmd_prefix;
  `, [guildId, prefix]);
}

async function filteringAI(guildId, userId, messageId, channelId, timestamp, userInfractions, content) {
  await ensureSchemaReady();
  await pool.query(`
    INSERT INTO filtered_messages (
      guild_id, user_id, message_id, channel_id, timestamp,
      hate, harassment, self_harm, sexual, violence, content
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
    guildId,
    userId,
    messageId,
    channelId,
    timestamp,
    userInfractions.hate,
    userInfractions.harassment,
    userInfractions.self_harm,
    userInfractions.sexual,
    userInfractions.violence,
    content
  ]);
}

function onGuildCreate(guild) {
  console.log(`[INFO] Joined a new guild: ${guild.name} (${guild.id})`);
}

async function syncGuildSettings(client) {
  await ensureSchemaReady();
  try {
    const botGuilds = client.guilds.cache.map(guild => guild.id);
    const res = await pool.query('SELECT guild_id FROM guild_settings');
    const dbGuilds = res.rows.map(row => row.guild_id);

    const missingGuilds = botGuilds.filter(id => !dbGuilds.includes(id));

    if (missingGuilds.length > 0) {
        for (const guildId of missingGuilds) {
          await pool.query(`
            INSERT INTO guild_settings (guild_id)
            VALUES ($1)
            ON CONFLICT (guild_id) DO NOTHING;
          `, [guildId]);
          console.log(`[INFO] [Database] Added missing guild settings for: ${guildId}`);
        }
    }
    console.log(`[INFO] [Database] Guild settings sync complete. Found ${missingGuilds.length} new guild(s).`);
  } catch (error) {
    console.error('[ERROR] [Database] Guild settings sync failed:', error);
  }
}

async function getGuildPrefix(guildId) {
  await ensureSchemaReady();
  try {
    const res = await pool.query(
      'SELECT cmd_prefix FROM guild_settings WHERE guild_id = $1',
      [guildId]
    );
    return res.rows[0]?.cmd_prefix ?? '!';
  } catch (err) {
    console.error(`[ERROR] [Database] Failed to get prefix for guild ${guildId}:`, err);
    return '!';
  }
}

async function getGuildSettings(guildId) {
  await ensureSchemaReady();
  const res = await pool.query(
    'SELECT * FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0] || null;
}

async function setRolePermissions(guildId, permissionType, roleIDs) {
  await ensureSchemaReady();
  const columnMap = {
    super_admin: 'roles_super_admin',
    admin: 'roles_admin',
    mod: 'roles_mod',
    jr_mod: 'roles_jr_mod',
    helper: 'roles_helper',
    trust: 'roles_trust',
    untrusted: 'roles_untrusted'
  };

  const column = columnMap[permissionType];
  if (!column) {
    throw new Error(`Invalid permission type: ${permissionType}. Valid types: ${Object.keys(columnMap).join(', ')}`);
  }

  const rolesJson = JSON.stringify(roleIDs);

  // Use upsert to ensure guild settings exist
  await pool.query(`
    INSERT INTO guild_settings (guild_id, ${column})
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET ${column} = EXCLUDED.${column};
  `, [guildId, rolesJson]);
}

// === PERMISSION CHECKING FUNCTIONS ===
function normalizeRoleIds(memberRoles) {
  if (memberRoles == null) {
    throw new Error('memberRoles is required for permission checks.');
  }

  if (Array.isArray(memberRoles)) {
    return memberRoles
      .map(role => (typeof role === 'string' ? role : role?.id))
      .filter(Boolean);
  }

  if (typeof memberRoles.values === 'function') {
    return Array.from(memberRoles.values())
      .map(role => (typeof role === 'string' ? role : role?.id))
      .filter(Boolean);
  }

  if (typeof memberRoles === 'object' && typeof memberRoles.forEach === 'function') {
    const ids = [];
    memberRoles.forEach(role => {
      const id = typeof role === 'string' ? role : role?.id;
      if (id) ids.push(id);
    });
    return ids;
  }

  throw new Error(`Unsupported memberRoles type: ${typeof memberRoles}`);
}

/**
 * Check if a user has a specific permission level or higher
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} requiredLevel - Required permission level
 * @param {Collection<string, Role>|Role[]|string[]} memberRoles - Discord member roles
 * @returns {Promise<boolean>} - True if user has permission
 */
async function hasPermissionLevel(guildId, userId, requiredLevel, memberRoles) {
  const settings = await getGuildSettings(guildId);
  if (!settings) return false;

  const roleIds = new Set(normalizeRoleIds(memberRoles));

  // Permission hierarchy (higher index = higher permission)
  const hierarchy = ['helper', 'jr_mod', 'mod', 'admin', 'super_admin'];
  const requiredIndex = hierarchy.indexOf(requiredLevel);
  
  if (requiredIndex === -1) return false;

  // Check each permission level from required level up to super_admin
  for (let i = requiredIndex; i < hierarchy.length; i++) {
    const level = hierarchy[i];
    const columnName = `roles_${level}`;
    const storedRoles = JSON.parse(settings[columnName] || '[]');

    if (storedRoles.some(roleId => roleIds.has(roleId))) {
      return true;
    }
  }

  return false;
}

/**
 * Get the highest permission level for a user
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {Collection<string, Role>|Role[]|string[]} memberRoles - Discord member roles
 * @returns {Promise<string|null>} - Highest permission level or null
 */
async function getUserPermissionLevel(guildId, userId, memberRoles) {
  const settings = await getGuildSettings(guildId);
  if (!settings) return null;

  const roleIds = new Set(normalizeRoleIds(memberRoles));

  // Check from highest to lowest permission
  const hierarchy = ['super_admin', 'admin', 'mod', 'jr_mod', 'helper'];
  
  for (const level of hierarchy) {
    const columnName = `roles_${level}`;
    const storedRoles = JSON.parse(settings[columnName] || '[]');

    if (storedRoles.some(roleId => roleIds.has(roleId))) {
      return level;
    }
  }

  return null;
}

// === MUTE FUNCTIONS ===
async function addMutedUser({ guildId, userId, reason, roles, actionedBy, length, expires }) {
  await ensureSchemaReady();
    const timestamp = Date.now().toString();
    const rolesJson = JSON.stringify(roles);
    await pool.query(`
        INSERT INTO muted_users (guild_id, user_id, active, reason, roles, actioned_by, length, expires, timestamp)
        VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8)
    `, [guildId, userId, reason, rolesJson, actionedBy, length, expires, timestamp]);
}
async function getActiveMute(guildId, userId) {
  await ensureSchemaReady();
    const res = await pool.query(
        'SELECT * FROM muted_users WHERE guild_id = $1 AND user_id = $2 AND active = TRUE',
        [guildId, userId]
    );
    return res.rows[0] || null;
}
async function getAllActiveMutes(client) {
  await ensureSchemaReady();
    const guilds = client.guilds.cache.map(g => g.id);
    if (guilds.length === 0) return [];

    const res = await pool.query(
        'SELECT * FROM muted_users WHERE active = TRUE AND guild_id = ANY($1::text[])',
        [guilds]
    );
    return res.rows;
}
async function getExpiredMutes() {
  await ensureSchemaReady();
    const now = Date.now().toString();
    const res = await pool.query(
        'SELECT * FROM muted_users WHERE active = TRUE AND CAST(expires AS BIGINT) <= $1',
        [now]
    );
    return res.rows;
}
async function deactivateMute(muteId) {
  await ensureSchemaReady();
    await pool.query(
        'UPDATE muted_users SET active = FALSE WHERE mute_id = $1',
        [muteId]
    );
}

// Export database pool and functions
module.exports = {
  // Core database connection
  pool,
  
  // Settings management
  updateGuildSetting,
  getGuildSettings,
  setRolePermissions,
  
  // Channel functions
  getLogChannelId,
  setLogChannelId,
  getVoiceLogChannelId,
  getJoinChannelId,
  getLeaveChannelId,
  
  // Prefix management
  getGuildPrefix,
  setGuildPrefix,
  
  // Feature toggles
  isOpenAIEnabled,
  
  // AI/Filtering
  filteringAI,
  
  // Guild management
  onGuildCreate,
  syncGuildSettings,
  
  // Mute system
  addMutedUser,
  getActiveMute,
  getAllActiveMutes,
  getExpiredMutes,
  deactivateMute,
  
  // Permission system
  hasPermissionLevel,
  getUserPermissionLevel,
};
