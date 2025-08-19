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

    if (!client.commands.has(commandName)) return;

    const command = client.commands.get(commandName);

    try {
      // Command execution logic remains the same
      await command.execute(message, args, client);
    } catch (error) {
      console.error(`[❌ ERROR] Error executing command ${commandName}:`, error);
      await message.reply('❌ There was an error executing that command.');
    }
  },

  loadCommands(client) {
    const commandsPath = path.join(__dirname, '../commands');

    // This inner function is now synchronous again
    function readCommands(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Recursive call is synchronous
          readCommands(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          try {
            // Reverted back to the synchronous require() to load command files
            const command = require(fullPath);

            const commandName = command.data?.name ?? command.name;

            if (!commandName || typeof command.execute !== 'function') {
              console.warn(`[⚠️ WARNING] Invalid command at ${fullPath} — missing 'name' or 'execute'.`);
              continue;
            }

            client.commands.set(commandName, command);
            console.log(`✅ Loaded command: ${commandName}`);
          } catch (err) {
            console.error(`[❌ ERROR] Failed to load command ${fullPath}:`, err);
          }
        }
      }
    }

    // Initial call to the synchronous function
    readCommands(commandsPath);
  }
};