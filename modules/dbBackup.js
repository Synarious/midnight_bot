const cron = require('node-cron');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { pool } = require('../data/database.js');

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backup');
let cachedOwnerId = null;

function resolveOwnerId() {
  if (cachedOwnerId) {
    return cachedOwnerId;
  }

  const raw = process.env.BOT_OWNER_ID;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  if (!trimmed) {
    throw new Error('BOT_OWNER_ID environment variable is not set or empty.');
  }

  cachedOwnerId = trimmed;
  return cachedOwnerId;
}

let scheduledJob = null;
let backupInProgress = false;

async function ensureBackupDirectory() {
  try {
    await fsPromises.mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    console.error('[DBBackup] Failed to ensure backup directory exists:', error);
    throw error;
  }
}

function formatTimeComponent(value) {
  return String(value).padStart(2, '0');
}

function buildBackupFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = formatTimeComponent(now.getMonth() + 1);
  const day = formatTimeComponent(now.getDate());
  const hours = formatTimeComponent(now.getHours());
  const minutes = formatTimeComponent(now.getMinutes());
  const seconds = formatTimeComponent(now.getSeconds());

  return `db-backup-${year}-${month}-${day}_${hours}-${minutes}-${seconds}.sql`;
}

async function generateSQLDump() {
  const client = await pool.connect();
  try {
    console.log('[DBBackup] Connected to database for backup generation');
    
    // Get all table names
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    console.log(`[DBBackup] Found ${tables.length} tables to backup: ${tables.join(', ')}`);
    
    let sqlDump = `-- Database backup generated on ${new Date().toISOString()}\n`;
    sqlDump += `-- PostgreSQL database dump\n\n`;
    
    // Generate CREATE TABLE statements and data
    for (const tableName of tables) {
      console.log(`[DBBackup] Processing table: ${tableName}`);
      
      // Get table structure
      const columnsResult = await client.query(`
        SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);
      
      // Build CREATE TABLE statement
      sqlDump += `-- Table: ${tableName}\n`;
      sqlDump += `DROP TABLE IF EXISTS "${tableName}" CASCADE;\n`;
      sqlDump += `CREATE TABLE "${tableName}" (\n`;
      
      const columnDefs = columnsResult.rows.map(col => {
        let def = `  "${col.column_name}" `;

        const dataType = col.data_type.toLowerCase();
        const hasNextval = col.column_default && col.column_default.toLowerCase().includes('nextval');
        const isIdentity = col.column_default && /identity/i.test(col.column_default);

        // If column is a sequence-backed column (nextval), emit the appropriate SERIAL/BIGSERIAL
        if (hasNextval && !isIdentity) {
          if (dataType === 'bigint') {
            def += 'BIGSERIAL';
          } else {
            // default to SERIAL for integer-like types
            def += 'SERIAL';
          }
        } else {
          // Map data types
          switch (dataType) {
            case 'character varying':
              def += col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'TEXT';
              break;
            case 'text':
              def += 'TEXT';
              break;
            case 'integer':
              def += 'INTEGER';
              break;
            case 'bigint':
              def += 'BIGINT';
              break;
            case 'boolean':
              def += 'BOOLEAN';
              break;
            case 'timestamp without time zone':
              def += 'TIMESTAMP';
              break;
            case 'timestamp with time zone':
              def += 'TIMESTAMPTZ';
              break;
            default:
              def += col.data_type.toUpperCase();
          }

          // If the column uses GENERATED ... AS IDENTITY in its default, preserve that
          if (isIdentity) {
            def += ' GENERATED ALWAYS AS IDENTITY';
          } else if (col.column_default) {
            def += ` DEFAULT ${col.column_default}`;
          }
        }

        if (col.is_nullable === 'NO') {
          def += ' NOT NULL';
        }

        return def;
      });
      
      sqlDump += columnDefs.join(',\n') + '\n);\n\n';
      
      // Get table data
      const dataResult = await client.query(`SELECT * FROM "${tableName}"`);
      
      if (dataResult.rows.length > 0) {
        sqlDump += `-- Data for table: ${tableName}\n`;
        
        const columns = columnsResult.rows.map(col => `"${col.column_name}"`).join(', ');
        
        for (const row of dataResult.rows) {
          const values = columnsResult.rows.map(col => {
            const value = row[col.column_name];
            if (value === null) return 'NULL';
            if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
            if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
            if (value instanceof Date) return `'${value.toISOString()}'`;
            return value;
          }).join(', ');
          
          sqlDump += `INSERT INTO "${tableName}" (${columns}) VALUES (${values});\n`;
        }
        
        sqlDump += '\n';
      }
    }
    
    // Get sequences and reset them
    const sequencesResult = await client.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public'
    `);
    
    for (const seq of sequencesResult.rows) {
      const seqResult = await client.query(`SELECT last_value FROM "${seq.sequence_name}"`);
      if (seqResult.rows.length > 0) {
        sqlDump += `SELECT setval('"${seq.sequence_name}"', ${seqResult.rows[0].last_value}, true);\n`;
      }
    }
    
    sqlDump += `\n-- Backup completed on ${new Date().toISOString()}\n`;
    
    return sqlDump;
    
  } finally {
    client.release();
  }
}

async function writeSQLDumpToFile(filePath) {
  console.log('[DBBackup] Generating SQL dump from database connection');
  
  const sqlDump = await generateSQLDump();
  
  console.log(`[DBBackup] Writing ${sqlDump.length} characters to ${filePath}`);
  await fsPromises.writeFile(filePath, sqlDump, 'utf8');
  
  return {
    command: 'Direct PostgreSQL connection',
    dumpSize: sqlDump.length
  };
}

async function performBackup({ reason = 'manual', invokedBy = 'system' } = {}) {
  if (backupInProgress) {
    return {
      success: false,
      message: 'A backup is already running. Please wait for it to finish.',
    };
  }

  backupInProgress = true;
  const startedAt = Date.now();
  let filePath = null;

  try {
    await ensureBackupDirectory();

    const fileName = buildBackupFilename();
    filePath = path.join(BACKUP_DIR, fileName);

    console.log(`[DBBackup] Starting backup (${reason}) initiated by ${invokedBy}. Target: ${filePath}`);

    const result = await writeSQLDumpToFile(filePath);
    console.log(`[DBBackup] Used backup method: ${result.command}`);

    // Verify backup file was created and has content
    const stats = await fsPromises.stat(filePath);
    if (stats.size === 0) {
      throw new Error('Backup file is empty');
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[DBBackup] Backup completed in ${(durationMs / 1000).toFixed(2)}s: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    return {
      success: true,
      filePath,
      durationMs,
      fileSize: stats.size,
    };
  } catch (error) {
    console.error('[DBBackup] Backup failed:', error);
    
    // Clean up failed backup file
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          await fsPromises.unlink(filePath);
          console.log(`[DBBackup] Cleaned up failed backup file: ${filePath}`);
        }
      } catch (cleanupError) {
        console.error('[DBBackup] Failed to clean up incomplete backup file:', cleanupError);
      }
    }

    return {
      success: false,
      message: error.message || 'Backup failed. Check logs for details.',
    };
  } finally {
    backupInProgress = false;
  }
}

function scheduleDailyBackup() {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }

  try {
    scheduledJob = cron.schedule('0 6 * * *', async () => {
      try {
        await performBackup({ reason: 'scheduled-6am-est', invokedBy: 'scheduler' });
      } catch (error) {
        console.error('[DBBackup] Scheduled backup failed:', error);
      }
    }, {
      scheduled: true,
      timezone: 'America/New_York',
    });

    console.log('[DBBackup] Scheduled daily backups for 6:00 AM America/New_York time.');
  } catch (error) {
    console.error('[DBBackup] Failed to schedule daily backups:', error);
    throw error;
  }
}

async function initialize() {
  try {
    // Validate configuration first
    resolveOwnerId();
    console.log(`[DBBackup] Using owner ID: ${cachedOwnerId}`);
    
    // Ensure backup directory exists
    await ensureBackupDirectory();
    console.log(`[DBBackup] Backup directory ready: ${BACKUP_DIR}`);
    
    // Schedule daily backups
    scheduleDailyBackup();
  } catch (error) {
    console.error('[DBBackup] Initialization failed:', error);
    throw error;
  }
}

function cleanup() {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    console.log('[DBBackup] Stopped scheduled backup job.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

module.exports = {
  getOwnerId: resolveOwnerId,
  initialize,
  triggerBackup: performBackup,
  isBackupInProgress: () => backupInProgress,
  cleanup,
};
