require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Client } = require('pg');
const readline = require('readline');

const backupDir = path.join(__dirname, 'data', 'backup');

/**
 * Prompts the user for input via readline
 */
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Fixes common syntax errors in backup files
 */
async function fixBackupFile(filePath) {
    const fixedPath = filePath.replace('.sql', '-fixed.sql');
    
    try {
        // Check if fixed version already exists
        await fs.access(fixedPath);
        console.log(`[INFO] Using existing fixed backup: ${fixedPath}`);
        return fixedPath;
    } catch {
        // Fixed version doesn't exist, create it
        console.log(`[INFO] Creating fixed backup file...`);
        
    const content = await fs.readFile(filePath, 'utf-8');

    // Normalize line endings
    let fixedContent = content.replace(/\r\n/g, '\n');

    // Remove opening and closing Markdown fences if present
    fixedContent = fixedContent.replace(/^```(?:sql)?\n/, '');
    fixedContent = fixedContent.replace(/\n```\s*$/,'\n');

    // Replace invalid `INTEGER SERIAL` with `SERIAL`
    fixedContent = fixedContent.replace(/INTEGER\s+SERIAL/g, 'SERIAL');

    // Fix SELECT setval calls that were saved like '"seq_name"'
    // convert SELECT setval('"seq"', n, true) -> SELECT setval('seq', n, true)
    fixedContent = fixedContent.replace(/SELECT\s+setval\(\s*'"?([^'"\)]+)"?'\s*,/g, "SELECT setval('$1',");

    // Write the fixed file
    await fs.writeFile(fixedPath, fixedContent, 'utf-8');
    console.log(`[INFO] Fixed backup created: ${fixedPath}`);

    return fixedPath;
    }
}

/**
 * Lists all backup files in the backup directory
 */
async function listBackupFiles() {
    try {
        const files = await fs.readdir(backupDir);
        const sqlFiles = files.filter(f => f.endsWith('.sql')).sort().reverse();
        return sqlFiles;
    } catch (err) {
        console.error('[ERROR] Failed to read backup directory:', err);
        return [];
    }
}

/**
 * Gets a preview of the backup file (first 50 lines)
 */
async function getBackupPreview(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, 50);
        return lines.join('\n');
    } catch (err) {
        console.error('[ERROR] Failed to read backup file:', err);
        return null;
    }
}

/**
 * Restores the database from a backup file
 */
async function restoreDatabase(backupFilePath) {
    // Fix any syntax errors in the backup file first
    const fixedBackupPath = await fixBackupFile(backupFilePath);
    
    // When running the recovery script, always connect to the exposed port on localhost
    // since this script is designed to be run from the host machine
    const client = new Client({
        host: 'localhost',
        port: 5434, // Exposed port from docker-compose.yml
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'postgres'
    });

    try {
        console.log('\n[INFO] Connecting to database...');
        console.log(`[INFO] Host: localhost, Port: 5434`);
        await client.connect();
        console.log('[INFO] Connected successfully.');

        console.log('[INFO] Reading backup file...');
        const sqlContent = await fs.readFile(fixedBackupPath, 'utf-8');

        console.log('[INFO] Executing SQL commands...');
        console.log('[WARN] This will DROP and recreate all tables!');
        
        await client.query(sqlContent);

        console.log('[SUCCESS] Database restored successfully!');
        return true;
    } catch (err) {
        console.error('[ERROR] Failed to restore database:', err);
        return false;
    } finally {
        await client.end();
    }
}

// CLI flags
const args = process.argv.slice(2);
const CLI_USE_LATEST = args.includes('--latest') || args.includes('-l');
const CLI_AUTO_YES = args.includes('--yes') || args.includes('-y') || args.includes('--confirm');
// Allow specifying a specific backup file non-interactively: --file <name> or --file=<name>
const CLI_FILE_ARG = (() => {
    const eq = args.find(a => a.startsWith('--file=') || a.startsWith('-f='));
    if (eq) return eq.split('=')[1];
    const idx = args.findIndex(a => a === '--file' || a === '-f');
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return null;
})();

/**
 * Main recovery function
 */
async function main() {
    console.log('='.repeat(60));
    console.log('DATABASE RECOVERY TOOL');
    console.log('='.repeat(60));
    console.log();

    let selectedFilePath = null;

    // If a specific file is requested via CLI, use it and skip interactive prompts
    if (CLI_FILE_ARG) {
        // Allow absolute path or relative to backupDir
        const candidate = path.isAbsolute(CLI_FILE_ARG) ? CLI_FILE_ARG : path.join(backupDir, CLI_FILE_ARG);
        try {
            await fs.access(candidate);
            selectedFilePath = candidate;
            console.log(`[INFO] Using requested backup file: ${path.basename(selectedFilePath)}`);
        } catch (err) {
            console.error('[ERROR] Specified backup file not found:', candidate);
            process.exit(1);
        }
    } else if (CLI_USE_LATEST) {
        // Automatically use the latest backup file
        console.log('[INFO] Using latest backup file automatically...');
        const backupFiles = await listBackupFiles();

        if (backupFiles.length === 0) {
            console.error('[ERROR] No backup files found in:', backupDir);
            process.exit(1);
        }

        selectedFilePath = path.join(backupDir, backupFiles[0]);
        console.log(`[INFO] Selected backup: ${backupFiles[0]}`);
    } else {
        // List available backups
        console.log('[INFO] Scanning for backup files...');
        const backupFiles = await listBackupFiles();

        if (backupFiles.length === 0) {
            console.error('[ERROR] No backup files found in:', backupDir);
            process.exit(1);
        }

        console.log(`[INFO] Found ${backupFiles.length} backup file(s):\n`);
        backupFiles.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file}`);
        });

        console.log();

        // Prompt user to select a backup (interactive)
        const selection = await prompt('Enter the number of the backup to restore (or "q" to quit): ');

        if (selection.toLowerCase() === 'q') {
            console.log('[INFO] Recovery cancelled.');
            process.exit(0);
        }

        const selectedIndex = parseInt(selection, 10) - 1;

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= backupFiles.length) {
            console.error('[ERROR] Invalid selection.');
            process.exit(1);
        }

        const selectedFile = backupFiles[selectedIndex];
        selectedFilePath = path.join(backupDir, selectedFile);

        console.log(`\n[INFO] Selected backup: ${selectedFile}`);
    }
    
    // Check if a fixed version exists; but avoid appending '-fixed' twice
    let fixedPath = selectedFilePath;
    if (!selectedFilePath.endsWith('-fixed.sql')) {
        const candidateFixed = selectedFilePath.replace(/\.sql$/i, '-fixed.sql');
        try {
            await fs.access(candidateFixed);
            fixedPath = candidateFixed;
            console.log(`[INFO] Fixed version available: ${path.basename(fixedPath)}`);
        } catch {
            // No fixed version, use original
        }
    } else {
        // selected file already the fixed version
        fixedPath = selectedFilePath;
    }

    let previewPath = fixedPath;
    
    console.log('[INFO] Fetching preview...\n');

    // Show preview
    const preview = await getBackupPreview(previewPath);
    if (preview) {
        console.log('-'.repeat(60));
        console.log('BACKUP PREVIEW (first 50 lines):');
        console.log('-'.repeat(60));
        console.log(preview);
        console.log('-'.repeat(60));
    }

    console.log();
    console.log('[WARN] This will restore the database using the selected backup.');
    console.log('[WARN] ALL EXISTING DATA WILL BE REPLACED!');
    console.log();
    
    // Show connection details for the Docker database
    console.log('Database connection details:');
    console.log(`  Host:     localhost (Docker container)`);
    console.log(`  Port:     5434 (exposed from container)`);
    console.log(`  Database: ${process.env.PGDATABASE || 'postgres'}`);
    console.log(`  User:     ${process.env.PGUSER || 'postgres'}`);
    console.log();

    // Confirm action
    let confirm = 'RESTORE';
    if (!CLI_AUTO_YES) {
        confirm = await prompt('Type "RESTORE" to confirm restoration (or anything else to cancel): ');
    }

    if (confirm !== 'RESTORE') {
        console.log('[INFO] Recovery cancelled.');
        process.exit(0);
    }

    // Perform restoration
    console.log('\n[INFO] Starting database restoration...');
    const success = await restoreDatabase(selectedFilePath);

    if (success) {
        console.log('\n[SUCCESS] Database recovery completed successfully!');
        process.exit(0);
    } else {
        console.log('\n[ERROR] Database recovery failed. Please check the error messages above.');
        process.exit(1);
    }
}

// Run the recovery tool
main().catch(err => {
    console.error('[FATAL] Unexpected error:', err);
    process.exit(1);
});
