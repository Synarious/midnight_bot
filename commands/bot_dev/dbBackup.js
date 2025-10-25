const path = require('path');
const dbBackup = require('../../utils/dbBackup.js');

module.exports = {
  name: 'db-backup',
  description: 'Creates a local PostgreSQL dump (bot owner only).',
  usage: '!db-backup',

  async execute(message, args) {
    let ownerId;
    try {
      ownerId = dbBackup.getOwnerId();
    } catch (error) {
      console.error('[db-backup] BOT_OWNER_ID is not configured:', error);
      return message.reply('❌ BOT_OWNER_ID is not configured in the environment.');
    }

    // Debug logging for owner ID comparison
    console.log(`[db-backup] Checking owner permissions: user=${message.author.id}, owner=${ownerId}`);
    
    if (message.author.id !== ownerId) {
      return message.reply('❌ Only the bot owner can run this command.');
    }

    if (dbBackup.isBackupInProgress()) {
      return message.reply('⚠️ A backup is already in progress. Please wait for it to finish.');
    }

    const reason = args.length > 0 ? `manual:${args.join(' ')}` : 'manual-command';

    await message.reply('🗄️ Starting database backup...');

    const result = await dbBackup.triggerBackup({
      reason,
      invokedBy: message.author.id,
    });

    if (!result.success) {
      return message.reply(`❌ Backup failed: ${result.message}`);
    }

    const relativePath = path.relative(process.cwd(), result.filePath);
    const durationSeconds = (result.durationMs / 1000).toFixed(2);
    const fileSizeMB = result.fileSize ? (result.fileSize / 1024 / 1024).toFixed(2) : 'unknown';

    return message.reply(`✅ Backup completed in ${durationSeconds}s. Saved to \`${relativePath}\` (${fileSizeMB} MB).`);
  },


  // Rate limit: 20 seconds 
  rateLimit: 20000,
};
