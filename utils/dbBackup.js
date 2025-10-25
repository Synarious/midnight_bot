const cron = require('node-cron');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { pool } = require('../data/database.js');
const { spawn } = require('child_process');

// Configurable retention (days)
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

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

function advisoryLockKey() {
  // Fixed lock key; can be changed if needed
  return 1234567890;
}

async function tryAcquireLock(client) {
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) as got', [advisoryLockKey()]);
    return res.rows[0]?.got === true;
  } catch (e) {
    console.warn('[DBBackup] Advisory lock failed:', e && e.message);
    return false;
  }
}

async function releaseLock(client) {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey()]);
  } catch (e) {
    console.warn('[DBBackup] Advisory unlock failed:', e && e.message);
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
  // Keep compatibility: original synchronous string-based dump generation
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

/**
 * Stream-based SQL dump fallback (uses transactional snapshot and streams output to file)
 */
async function generateSQLDumpToStream(stream, client) {
  // Assumes caller has connected client and will commit/close
  // Begin a repeatable read transaction to get a snapshot
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');

  stream.write(`-- Database backup generated on ${new Date().toISOString()}\n`);
  stream.write(`-- PostgreSQL database dump (streaming fallback)\n\n`);

  const tablesResult = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  const tables = tablesResult.rows.map(r => r.table_name);

  for (const tableName of tables) {
    stream.write(`-- Table: ${tableName}\n`);
    stream.write(`DROP TABLE IF EXISTS "${tableName}" CASCADE;\n`);

    const columnsResult = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [tableName]);

    stream.write(`CREATE TABLE "${tableName}" (\n`);
    const columnDefs = columnsResult.rows.map(col => {
      let def = `  "${col.column_name}" `;
      const dataType = col.data_type.toLowerCase();
      const hasNextval = col.column_default && col.column_default.toLowerCase().includes('nextval');
      const isIdentity = col.column_default && /identity/i.test(col.column_default);

      if (hasNextval && !isIdentity) {
        if (dataType === 'bigint') def += 'BIGSERIAL';
        else def += 'SERIAL';
      } else {
        switch (dataType) {
          case 'character varying':
            def += col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'TEXT';
            break;
          case 'text': def += 'TEXT'; break;
          case 'integer': def += 'INTEGER'; break;
          case 'bigint': def += 'BIGINT'; break;
          case 'boolean': def += 'BOOLEAN'; break;
          case 'timestamp without time zone': def += 'TIMESTAMP'; break;
          case 'timestamp with time zone': def += 'TIMESTAMPTZ'; break;
          default: def += col.data_type.toUpperCase();
        }

        if (isIdentity) {
          def += ' GENERATED ALWAYS AS IDENTITY';
        } else if (col.column_default) {
          def += ` DEFAULT ${col.column_default}`;
        }
      }

      if (col.is_nullable === 'NO') def += ' NOT NULL';
      return def;
    });

    stream.write(columnDefs.join(',\n') + '\n);\n\n');

    // Data
    const dataResult = await client.query(`SELECT * FROM "${tableName}"`);
    if (dataResult.rows.length > 0) {
      stream.write(`-- Data for table: ${tableName}\n`);
      const columns = columnsResult.rows.map(col => `"${col.column_name}"`).join(', ');

      for (const row of dataResult.rows) {
        const values = columnsResult.rows.map(col => {
          const value = row[col.column_name];
          if (value === null) return 'NULL';
          if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
          if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
          if (value instanceof Date) return `'${value.toISOString()}'`;
          if (typeof value === 'object') {
            // JSON / JSONB / arrays - serialize to JSON and cast to jsonb
            const jsonText = JSON.stringify(value).replace(/'/g, "''");
            return `'${jsonText}'::jsonb`;
          }
          return String(value);
        }).join(', ');

        stream.write(`INSERT INTO "${tableName}" (${columns}) VALUES (${values});\n`);
      }
      stream.write('\n');
    }
  }

  // Sequences
  const sequencesResult = await client.query(`
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  `);

  for (const seq of sequencesResult.rows) {
    const fq = `${seq.sequence_schema}.${seq.sequence_name}`;
    try {
      const seqVal = await client.query(`SELECT last_value FROM "${seq.sequence_schema}"."${seq.sequence_name}"`);
      if (seqVal.rows.length > 0) {
        stream.write(`SELECT setval('${seq.sequence_schema}.${seq.sequence_name}', ${seqVal.rows[0].last_value}, true);\n`);
      }
    } catch (e) {
      // ignore sequence read errors
      console.warn('[DBBackup] Could not read sequence', fq, e && e.message);
    }
  }

  stream.write(`\n-- Backup completed on ${new Date().toISOString()}\n`);
  await client.query('COMMIT');
}

async function runPgDump(filePath) {
  return new Promise((resolve, reject) => {
    const pgDump = 'pg_dump';
    const args = ['--format=plain', '--no-owner', '--no-privileges', '-h', process.env.PGHOST || 'localhost', '-U', process.env.PGUSER || 'postgres', '-d', process.env.PGDATABASE || 'postgres', '-f', filePath];
    const env = { ...process.env };

    const pd = spawn(pgDump, args, { env });

    pd.on('error', (err) => {
      reject(err);
    });

    pd.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

async function writeSQLDumpToFile(filePath) {
  console.log('[DBBackup] Attempting to run pg_dump (preferred)');
  // write to a temp file first
  const tempPath = `${filePath}.inprogress`;

  try {
    // Try pg_dump first
    await runPgDump(tempPath);
    // set permissions
    try { await fsPromises.chmod(tempPath, 0o600); } catch {};
    // atomic rename
    await fsPromises.rename(tempPath, filePath);
    const stats = await fsPromises.stat(filePath);
    return { command: 'pg_dump', dumpSize: stats.size };
  } catch (pgErr) {
    console.warn('[DBBackup] pg_dump failed, falling back to streaming SQL generator:', pgErr && pgErr.message);
    // Cleanup temp file if exists
    try { if (fs.existsSync(tempPath)) await fsPromises.unlink(tempPath); } catch {}

    // streaming fallback
    const client = await pool.connect();
    try {
      const stream = fs.createWriteStream(tempPath, { encoding: 'utf8' });
      await generateSQLDumpToStream(stream, client);
      stream.end();
      // wait for stream to finish
      await new Promise((res, rej) => stream.on('finish', res).on('error', rej));
      await fsPromises.chmod(tempPath, 0o600).catch(() => {});
      await fsPromises.rename(tempPath, filePath);
      const stats = await fsPromises.stat(filePath);
      return { command: 'streaming_sql', dumpSize: stats.size };
    } finally {
      client.release();
    }
  }
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

      // Acquire a simple advisory lock to avoid concurrent backups across instances
      const lockClient = await pool.connect();
      let lockAcquired = false;
      try {
        lockAcquired = await tryAcquireLock(lockClient);
        if (!lockAcquired) {
          throw new Error('Could not acquire backup advisory lock; another backup may be running.');
        }

        const result = await writeSQLDumpToFile(filePath);
        console.log(`[DBBackup] Used backup method: ${result.command}`);

        // Verify backup file was created and has content
        const stats = await fsPromises.stat(filePath);
        if (stats.size === 0) {
          throw new Error('Backup file is empty');
        }

        // set restrictive permissions
        try { await fsPromises.chmod(filePath, 0o600); } catch {}

        const durationMs = Date.now() - startedAt;
        console.log(`[DBBackup] Backup completed in ${(durationMs / 1000).toFixed(2)}s: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        // Retention cleanup
        try {
          if (RETENTION_DAYS > 0) {
            const files = await fsPromises.readdir(BACKUP_DIR);
            const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
            for (const f of files) {
              if (!f.endsWith('.sql')) continue;
              const p = path.join(BACKUP_DIR, f);
              const st = await fsPromises.stat(p);
              if (st.mtimeMs < cutoff) {
                await fsPromises.unlink(p).catch(() => {});
                console.log(`[DBBackup] Retention: deleted old backup ${p}`);
              }
            }
          }
        } catch (retErr) {
          console.warn('[DBBackup] Retention cleanup failed:', retErr && retErr.message);
        }

        return {
          success: true,
          filePath,
          durationMs,
          fileSize: stats.size,
        };
      } finally {
        if (lockAcquired) {
          await releaseLock(lockClient).catch(() => {});
        }
        lockClient.release();
      }
    } catch (error) {
      console.error('[DBBackup] Backup failed:', error);

      // Clean up failed backup file and any temp file
      if (filePath) {
        try {
          const tempPath = `${filePath}.inprogress`;
          if (fs.existsSync(tempPath)) {
            await fsPromises.unlink(tempPath).catch(() => {});
            console.log(`[DBBackup] Cleaned up failed temp backup file: ${tempPath}`);
          }
          if (fs.existsSync(filePath)) {
            await fsPromises.unlink(filePath).catch(() => {});
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
