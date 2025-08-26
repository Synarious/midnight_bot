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
  roles_admin TEXT DEFAULT '[]',
  roles_mod TEXT DEFAULT '[]',
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
  content TEXT
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
  timestamp TEXT
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
`;

// Function to check for a column and add it if it doesn't exist
async function checkAndAddColumn(client, tableName, columnName, columnDefinition) {
  const checkQuery = `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2;
  `;
  const { rowCount } = await client.query(checkQuery, [tableName, columnName]);

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