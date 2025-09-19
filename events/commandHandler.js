const fs = require('fs');
const path = require('path');
const db = require('../data/database.js');

module.exports = {
  async execute(client, message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guildId = message.guild.id;

    // Get prefix from PostgreSQL
    let prefix = '!'; // Default prefix
    try {
      prefix = await db.getGuildPrefix(guildId);
    } catch (err) {
      console.error(`[❌ DATABASE] Failed to get prefix for guild ${guildId}:`, err);
    }

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Only look for legacy commands in prefix-based messages
    const command = client.commands.get(commandName);

    if (!command) return;

    try {
        await command.execute(message, args, client);
    } catch (error) {
      console.error(`[❌ ERROR] Error executing command ${commandName}:`, error);
      await message.reply('❌ There was an error executing that command.');
    }
  },

  loadCommands(client) {
    // Load slash commands from /commands directory
    const slashCommandsPath = path.join(__dirname, '../commands');
    // Load legacy commands from /legacy_commands directory
    const legacyCommandsPath = path.join(__dirname, '../legacy_commands');

    // This inner function is now synchronous and handles both command types
    function readCommands(dir, isSlashCommand = true) {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          readCommands(fullPath, isSlashCommand);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          try {
            const command = require(fullPath);

            if (typeof command.execute !== 'function') {
              console.warn(`[⚠️ WARNING] Command at ${fullPath} is missing execute function`);
              continue;
            }

            if (isSlashCommand) {
              // Slash commands must have data property
              if (!command.data) {
                console.warn(`[⚠️ WARNING] Slash command at ${fullPath} is missing data property`);
                continue;
              }
              if (client.slashCommands.has(command.data.name)) {
                console.warn(`[⚠️ WARNING] Duplicate slash command name '${command.data.name}' at ${fullPath}`);
                continue;
              }
              client.slashCommands.set(command.data.name, command);
              console.log(`✅ Loaded slash command: ${command.data.name}`);
            } else {
              // Legacy commands must have name property
              if (!command.name) {
                console.warn(`[⚠️ WARNING] Legacy command at ${fullPath} is missing name property`);
                continue;
              }
              if (client.commands.has(command.name)) {
                console.warn(`[⚠️ WARNING] Duplicate legacy command name '${command.name}' at ${fullPath}`);
                continue;
              }
              client.commands.set(command.name, command);
              console.log(`✅ Loaded legacy command: ${command.name}`);
            }
          } catch (err) {
            console.error(`[❌ ERROR] Failed to load command ${fullPath}:`, err);
          }
        }
      }
    }

    // Load both types of commands
    console.log('[INFO] Loading slash commands...');
    readCommands(slashCommandsPath, true);
    console.log('[INFO] Loading legacy commands...');
    readCommands(legacyCommandsPath, false);
  }
};