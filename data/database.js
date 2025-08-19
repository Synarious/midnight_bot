require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(); // Uses .env values by default

console.log('[DATABASE] Connected to PostgreSQL');

// === Functions ===

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
  console.log(`Joined a new guild: ${guild.name}`);
}

async function syncGuildSettings(client) {
  try {
    const botGuilds = client.guilds.cache.map(guild => guild.id);
    const res = await pool.query('SELECT guild_id FROM guild_settings');
    const dbGuilds = res.rows.map(row => row.guild_id);

    const missingGuilds = botGuilds.filter(id => !dbGuilds.includes(id));

    for (const guildId of missingGuilds) {
      await pool.query(`
        INSERT INTO guild_settings (guild_id)
        VALUES ($1)
        ON CONFLICT (guild_id) DO NOTHING;
      `, [guildId]);
      console.log(`[DATABASE] Added missing guild_id: ${guildId}`);
    }

    console.log(`[DATABASE] syncGuildSettings complete. Added ${missingGuilds.length} missing guild(s).`);
  } catch (error) {
    console.error('[❌ DATABASE] syncGuildSettings failed:', error);
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
    console.error(`[❌ DATABASE] Failed to get prefix for guild ${guildId}:`, err);
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

// Export all database functions using module.exports
module.exports = {
  pool,
  getLogChannelId,
  setLogChannelId,
  getVoiceLogChannelId,
  getGuildPrefix,
  getJoinChannelId,
  getLeaveChannelId,
  isOpenAIEnabled,
  setGuildPrefix,
  filteringAI,
  onGuildCreate,
  syncGuildSettings,
  getGuildSettings,
  setRolePermissions
};
