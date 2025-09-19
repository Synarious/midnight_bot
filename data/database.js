require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(); // Uses .env values by default

console.log('[INFO] [Database] Successfully connected to PostgreSQL.');

// A whitelist of columns that are allowed to be updated by the setup command.
// This is a security measure to prevent updating sensitive or structural columns like 'guild_id'.
const updatableColumns = new Set([
    'cmd_prefix', 'bot_enabled', 'roles_admin', 'roles_mod', 'roles_trust',
    'roles_untrusted', 'enable_automod', 'enable_openAI', 'mute_roleID',
    'mute_rolesRemoved', 'mute_immuneUserIDs', 'kick_immuneRoles', 'kick_immuneUserID',
    'ban_immuneRoles', 'ban_immuneUserID', 'ch_actionLog', 'ch_kickbanLog',
    'ch_auditLog', 'ch_airlockJoin', 'ch_airlockLeave', 'ch_deletedMessages',
    'ch_editedMessages', 'ch_automod_AI', 'ch_voiceLog', 'ch_categoryIgnoreAutomod',
    'ch_channelIgnoreAutomod'
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
  const res = await pool.query(
    'SELECT ch_automod_AI FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_automod_ai || null;
}

async function getVoiceLogChannelId(guildId) {
  const res = await pool.query(
    'SELECT ch_voicelog FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_voicelog || null;
}

async function getJoinChannelId(guildId) {
  const res = await pool.query(
    'SELECT ch_airlockJoin FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_airlockjoin || null;
}

async function getLeaveChannelId(guildId) {
  const res = await pool.query(
    'SELECT ch_airlockLeave FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.ch_airlockleave || null;
}

async function isOpenAIEnabled(guildId) {
  const res = await pool.query(
    'SELECT enable_openAI FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.enable_openai === true;
}

async function setLogChannelId(guildId, logChannelId) {
  await pool.query(`
    INSERT INTO guild_settings (guild_id, ch_automod_AI)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET ch_automod_AI = EXCLUDED.ch_automod_AI;
  `, [guildId, logChannelId]);
}

async function setGuildPrefix(guildId, prefix) {
  await pool.query(`
    INSERT INTO guild_settings (guild_id, cmd_prefix)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET cmd_prefix = EXCLUDED.cmd_prefix;
  `, [guildId, prefix]);
}

async function filteringAI(guildId, userId, messageId, channelId, timestamp, userInfractions, content) {
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
  const res = await pool.query(
    'SELECT * FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0] || null;
}

async function setRolePermissions(guildId, permissionType, roleIDs) {
  const columnMap = {
    admin: 'roles_admin',
    mod: 'roles_mod',
    trust: 'roles_trust',
  };

  const column = columnMap[permissionType];
  if (!column) {
    throw new Error(`Invalid permission type: ${permissionType}`);
  }

  const rolesJson = JSON.stringify(roleIDs);

  await pool.query(
    `UPDATE guild_settings SET ${column} = $1 WHERE guild_id = $2`,
    [rolesJson, guildId]
  );
}

// === MUTE FUNCTIONS ===
async function addMutedUser({ guildId, userId, reason, roles, actionedBy, length, expires }) {
    const timestamp = Date.now().toString();
    const rolesJson = JSON.stringify(roles);
    await pool.query(`
        INSERT INTO muted_users (guild_id, user_id, active, reason, roles, actioned_by, length, expires, timestamp)
        VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8)
    `, [guildId, userId, reason, rolesJson, actionedBy, length, expires, timestamp]);
}
async function getActiveMute(guildId, userId) {
    const res = await pool.query(
        'SELECT * FROM muted_users WHERE guild_id = $1 AND user_id = $2 AND active = TRUE',
        [guildId, userId]
    );
    return res.rows[0] || null;
}
async function getAllActiveMutes(client) {
    const guilds = client.guilds.cache.map(g => g.id);
    if (guilds.length === 0) return [];

    const res = await pool.query(
        'SELECT * FROM muted_users WHERE active = TRUE AND guild_id = ANY($1::text[])',
        [guilds]
    );
    return res.rows;
}
async function getExpiredMutes() {
    const now = Date.now().toString();
    const res = await pool.query(
        'SELECT * FROM muted_users WHERE active = TRUE AND CAST(expires AS BIGINT) <= $1',
        [now]
    );
    return res.rows;
}
async function deactivateMute(muteId) {
    await pool.query(
        'UPDATE muted_users SET active = FALSE WHERE mute_id = $1',
        [muteId]
    );
}

// Helper for converting ? placeholders to $1, $2, etc.
function convertPlaceholders(sql) {
  let paramCount = 0;
  return sql.replace(/\?/g, () => `$${++paramCount}`);
}

// SQLite-style prepared statement compatibility wrapper
function prepareStatement(sql) {
  const pgSql = convertPlaceholders(sql);
  
  return {
    get: async (...params) => {
      const result = await pool.query(pgSql, params);
      return result.rows[0];
    },
    all: async (...params) => {
      const result = await pool.query(pgSql, params);
      return result.rows;
    },
    run: async (...params) => {
      return pool.query(pgSql, params);
    }
  };
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
};
