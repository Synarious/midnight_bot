#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SQL_PATH = path.join(__dirname, '..', 'db-init', 'init.sql');
const MAX_RETRIES = Number.parseInt(process.env.DB_INIT_MAX_RETRIES || '30', 10);
const RETRY_DELAY_MS = Number.parseInt(process.env.DB_INIT_RETRY_DELAY_MS || '3000', 10);

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fileExists(p) {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  if (!(await fileExists(SQL_PATH))) {
    console.log(`[apply_init_sql] No init SQL found at ${SQL_PATH}; skipping database initialization.`);
    return;
  }

  const sql = await fs.promises.readFile(SQL_PATH, 'utf8');

  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      console.log(`[apply_init_sql] Attempt ${attempt} - connecting to database ${process.env.PGDATABASE} at ${process.env.PGHOST}:${process.env.PGPORT || 5432}`);
      // simple connectivity check
      await pool.query('SELECT 1');

      console.log('[apply_init_sql] Connected. Applying init SQL...');
      // Run the SQL as-is; the SQL uses IF NOT EXISTS so it's safe to run again
      await pool.query(sql);
      console.log('[apply_init_sql] init.sql applied successfully (or already present).');
      await pool.end();
      return;
    } catch (err) {
      console.warn(`[apply_init_sql] Attempt ${attempt} failed: ${err.message}`);
      if (attempt >= MAX_RETRIES) {
        console.error('[apply_init_sql] Max attempts reached. Giving up.');
        try { await pool.end(); } catch (_) {}
        process.exitCode = 1;
        return;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

main().catch((err) => {
  console.error('[apply_init_sql] Unexpected error:', err);
  process.exit(1);
});
