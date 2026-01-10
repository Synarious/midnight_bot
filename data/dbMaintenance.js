// ==== new dbmaintenance.js ====

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT || 5432,
});

// The base schema definition
const initSQL = `
CREATE TABLE IF NOT EXISTS guild_settings (
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
  enable_ch_actionLog BOOLEAN DEFAULT TRUE,
  ch_kickbanLog TEXT,
  enable_ch_kickbanLog BOOLEAN DEFAULT TRUE,
  ch_auditLog TEXT,
  enable_ch_auditLog BOOLEAN DEFAULT TRUE,
  ch_airlockJoin TEXT,
  enable_ch_airlockJoin BOOLEAN DEFAULT TRUE,
  ch_airlockLeave TEXT,
  enable_ch_airlockLeave BOOLEAN DEFAULT TRUE,
  ch_deletedMessages TEXT,
  enable_ch_deletedMessages BOOLEAN DEFAULT TRUE,
  ch_editedMessages TEXT,
  enable_ch_editedMessages BOOLEAN DEFAULT TRUE,
  ch_automod_AI TEXT,
  enable_ch_automod_AI BOOLEAN DEFAULT TRUE,
  ch_voiceLog TEXT,
  enable_ch_voiceLog BOOLEAN DEFAULT TRUE,
  ch_inviteLog TEXT,
  enable_ch_inviteLog BOOLEAN DEFAULT TRUE,
  ch_permanentInvites TEXT,
  enable_ch_permanentInvites BOOLEAN DEFAULT TRUE,
  ch_memberJoin TEXT,
  enable_ch_memberJoin BOOLEAN DEFAULT TRUE,
  ch_categoryIgnoreAutomod TEXT DEFAULT '[]',
  ch_channelIgnoreAutomod TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS filtered_messages (
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
  content TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS muted_users (
  mute_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT,
  user_id TEXT,
  active BOOLEAN,
  reason TEXT,
  roles TEXT,
  actioned_by TEXT,
  length TEXT,
  expires TEXT,
  timestamp TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invite_log (
  log_id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT,
  utc_time TIMESTAMP NOT NULL,
  invite_code TEXT NOT NULL,
  invite_creator TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  max_uses INTEGER DEFAULT 0,
  temporary BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP,
  uses_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_info (
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
);

CREATE INDEX IF NOT EXISTS idx_filtered_messages_guild_recorded_at ON filtered_messages (guild_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_muted_users_guild_active ON muted_users (guild_id, active);
CREATE INDEX IF NOT EXISTS idx_muted_users_active_expires_at ON muted_users (active, expires_at);
CREATE INDEX IF NOT EXISTS idx_invite_log_guild_created_at ON invite_log (guild_id, created_at);
`;

// Function to check for a column and add it if it doesn't exist
async function checkAndAddColumn(client, tableName, columnName, columnDefinition) {
  const checkQuery = `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2;
  `;
  // Always check for the lowercase version of the column name
  const { rowCount } = await client.query(checkQuery, [tableName, columnName.toLowerCase()]);

  if (rowCount === 0) {
    console.log(`[DB] [MIGRATION] Column "${columnName}" not found in "${tableName}". Adding it...`);
    const alterQuery = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`;
    await client.query(alterQuery);
    console.log(`[DB] [MIGRATION] Column "${columnName}" added successfully.`);
  }
}


async function runDBMaintenance() {
  const client = await pool.connect();
  try {
    console.log('[DB] Ensuring base schema is up to date...');
    await client.query(initSQL);
    console.log('[DB] Base schema check completed.');

    console.log('[DB] Running schema migrations...');
    // --- Add future schema changes below this line ---

    // Example Migration: This ensures the 'active' column exists in 'muted_users'.
    // The previous check in initSQL would add it, but this is a more explicit and scalable way.
    // The check in initSQL has been updated to include it, but this is good practice.
    await checkAndAddColumn(client, 'muted_users', 'active', 'BOOLEAN');

    // Add columns to existing invite_log table if they don't exist
    await checkAndAddColumn(client, 'invite_log', 'invite_code', 'TEXT');
    await checkAndAddColumn(client, 'invite_log', 'creator_id', 'TEXT NOT NULL DEFAULT \'\'');
    await checkAndAddColumn(client, 'invite_log', 'creator_name', 'TEXT NOT NULL DEFAULT \'\'');
    await checkAndAddColumn(client, 'invite_log', 'channel_id', 'TEXT NOT NULL DEFAULT \'\'');
    await checkAndAddColumn(client, 'invite_log', 'channel_name', 'TEXT NOT NULL DEFAULT \'\'');
    await checkAndAddColumn(client, 'invite_log', 'max_uses', 'INTEGER DEFAULT 0');
    await checkAndAddColumn(client, 'invite_log', 'temporary', 'BOOLEAN DEFAULT FALSE');
    await checkAndAddColumn(client, 'invite_log', 'expires_at', 'TIMESTAMP');
    await checkAndAddColumn(client, 'invite_log', 'uses_count', 'INTEGER DEFAULT 0');

    // Add new invite tracking columns to guild_settings
    await checkAndAddColumn(client, 'guild_settings', 'ch_inviteLog', 'TEXT');
    await checkAndAddColumn(client, 'guild_settings', 'ch_permanentInvites', 'TEXT');
    await checkAndAddColumn(client, 'guild_settings', 'ch_memberJoin', 'TEXT');

    // Logging enable flags (separate from channel selection)
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_actionLog', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_kickbanLog', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_auditLog', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_airlockJoin', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_airlockLeave', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_deletedMessages', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_editedMessages', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_automod_AI', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_voiceLog', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_inviteLog', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_permanentInvites', 'BOOLEAN DEFAULT TRUE');
    await checkAndAddColumn(client, 'guild_settings', 'enable_ch_memberJoin', 'BOOLEAN DEFAULT TRUE');

    // Add 5-tier permission system columns
    await checkAndAddColumn(client, 'guild_settings', 'roles_super_admin', 'TEXT DEFAULT \'[]\'');
    await checkAndAddColumn(client, 'guild_settings', 'roles_jr_mod', 'TEXT DEFAULT \'[]\'');
    await checkAndAddColumn(client, 'guild_settings', 'roles_helper', 'TEXT DEFAULT \'[]\'');

  await checkAndAddColumn(client, 'filtered_messages', 'recorded_at', 'TIMESTAMPTZ DEFAULT NOW()');
  await checkAndAddColumn(client, 'muted_users', 'recorded_at', 'TIMESTAMPTZ DEFAULT NOW()');
  await checkAndAddColumn(client, 'muted_users', 'expires_at', 'TIMESTAMPTZ');

  await client.query('UPDATE filtered_messages SET recorded_at = NOW() WHERE recorded_at IS NULL;');
  await client.query('UPDATE muted_users SET recorded_at = NOW() WHERE recorded_at IS NULL;');
  await client.query("UPDATE muted_users SET expires_at = COALESCE(expires_at, to_timestamp(expires::double precision / 1000)) WHERE expires_at IS NULL AND expires IS NOT NULL AND expires <> '' AND expires ~ '^\\d+$';");

  await client.query('CREATE INDEX IF NOT EXISTS idx_filtered_messages_guild_recorded_at ON filtered_messages (guild_id, recorded_at);');
  await client.query('CREATE INDEX IF NOT EXISTS idx_muted_users_guild_active ON muted_users (guild_id, active);');
  await client.query('CREATE INDEX IF NOT EXISTS idx_muted_users_active_expires_at ON muted_users (active, expires_at);');
  await client.query('CREATE INDEX IF NOT EXISTS idx_invite_log_guild_created_at ON invite_log (guild_id, created_at);');


    // --- End of schema changes ---
    console.log('[DB] Schema migration check finished.');

  } catch (err) {
    console.error('[DB] Error during schema maintenance:', err);
    throw err; // Re-throw the error to ensure the bot startup fails if DB is broken
  } finally {
    client.release();
  }
}

// Separate function to be called from main entry point
async function performMaintenanceAndExit() {
  try {
    await runDBMaintenance();
    console.log('[DB] Maintenance script finished successfully.');
  } catch (err) {
    console.error('[DB] Maintenance script failed:', err);
    process.exit(1); // Exit with error code if maintenance fails
  } finally {
    await pool.end(); // Close all connections in the pool
  }
}

// This allows the script to be run directly if needed, but exports the main function
if (require.main === module) {
  performMaintenanceAndExit();
}


module.exports = {
  runDBMaintenance,
};