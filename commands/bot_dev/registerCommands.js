const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OWNER_ID = process.env.BOT_OWNER_ID; // Set your Discord user ID in .env

function collectSlashCommands(baseDir) {
  const commands = [];
  const seenNames = new Set();

  function traverse(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        traverse(entryPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

      try {
        delete require.cache[require.resolve(entryPath)];
        const commandModule = require(entryPath);
        if (!commandModule) continue;

        const isSlash = commandModule.data?.name && typeof commandModule.execute === 'function';
        const isLegacy = commandModule.name && typeof commandModule.execute === 'function' && !commandModule.data;

        if (!isSlash) {
          if (isLegacy) {
            console.log(`[SKIP] Legacy command excluded from guild registration: ${commandModule.name} (${entryPath})`);
          } else {
            console.warn(`[WARN] Skipping file without slash command data: ${entryPath}`);
          }
          continue;
        }

        const name = commandModule.data.name;
        if (seenNames.has(name)) {
          console.error(`[ERROR] Duplicate slash command '${name}' detected at ${entryPath}. Skipping.`);
          continue;
        }
        seenNames.add(name);

        commands.push(commandModule.data.toJSON());
      } catch (err) {
        console.error(`[❌ ERROR] Failed to load command at ${entryPath}:`, err);
      }
    }
  }

  traverse(baseDir);
  return commands;
}

module.exports = {
  name: 'registercommands',
  description: 'Refresh or clear slash commands for this guild (owner only).',
  usage: '!registercommands [sync|clear]',

  async execute(message, args, client) {
    if (message.author.id !== OWNER_ID) {
      return message.reply('❌ Only the bot owner can use this command.');
    }

    const guild = message.guild;
    if (!guild) {
      return message.reply('❌ This command must be used inside a guild.');
    }

    await client.application?.fetch().catch(() => {});
    const applicationId = client.application?.id || client.user?.id;
    if (!applicationId) {
      return message.reply('❌ Unable to determine application ID.');
    }

    const token = process.env.DISCORD_TOKEN || process.env.TOKEN || client.token;
    if (!token) {
      console.error('[❌ ERROR] DISCORD_TOKEN / TOKEN is not set in the environment.');
      return message.reply('❌ Bot token missing from environment.');
    }

    const mode = (args[0] || 'sync').toLowerCase();
    const rest = new REST({ version: '10' }).setToken(token);

    try {
      if (mode === 'clear') {
        await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: [] });
        const clearedMsg = '🧹 Cleared guild-specific slash commands. Only global commands will remain.';
        console.log(`[REGISTER COMMANDS] ${clearedMsg} (Guild ${guild.id})`);
        return message.reply(clearedMsg);
      }

      const commandsBasePath = path.join(__dirname, '..');
      const commands = collectSlashCommands(commandsBasePath);

      if (commands.length === 0) {
        return message.reply('⚠️ No slash commands were found to register.');
      }

      await rest.put(
        Routes.applicationGuildCommands(applicationId, guild.id),
        { body: commands }
      );

      const successMsg = `✅ Registered ${commands.length} slash command${commands.length === 1 ? '' : 's'} for **${guild.name}**.`;
      console.log(successMsg);
      return message.reply(successMsg);
    } catch (error) {
      console.error('[❌ ERROR] Failed to register commands:', error);
      return message.reply('❌ Failed to register commands. Check console logs.');
    }
  },


  // Rate limit: 10 seconds 
  rateLimit: 10000,
};
