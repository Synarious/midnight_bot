#!/usr/bin/env node

require('dotenv').config();

const { runMigrations, shutdown } = require('./data/database');

async function main() {
  try {
    await runMigrations();
    console.log('✅ Database migrations complete.');
  } catch (error) {
    console.error('❌ Migration execution failed:', error);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main();
