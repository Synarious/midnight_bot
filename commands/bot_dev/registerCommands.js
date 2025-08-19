const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Replace with your actual user ID (bot owner)
const OWNER_ID = '134118092082118657';

module.exports = {
  name: 'registercommands',
  description: 'Manually registers all slash commands for this guild (owner only)',

  // Executes on message, params: message, args, client
  async execute(message, args, client) {
    if (message.author.id !== OWNER_ID) {
      return message.reply('❌ Only the bot owner can use this command.');
    }

    const clientId = client.user.id;
    const token = client.token;
    const guildId = message.guild.id;

    const commands = [];
    const commandsBasePath = path.join(__dirname, '..');

    // Read all command folders (assumes commands organized in subfolders)
    const commandFolders = fs.readdirSync(commandsBasePath);

    for (const folder of commandFolders) {
      const folderPath = path.join(commandsBasePath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

      for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        try {
          const command = require(filePath);

          // Only include commands with slash command data (for registration)
          if (command.data) {
            commands.push(command.data.toJSON());
          }
        } catch (error) {
          console.error(`[❌ ERROR] Failed to load command ${filePath}:`, error);
        }
      }
    }

    const rest = new REST({ version: '10' }).setToken(token);

    try {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ Successfully registered ${commands.length} slash commands to guild ${guildId}.`);
      return message.reply(`✅ Successfully registered ${commands.length} slash commands to **${message.guild.name}**.`);
    } catch (error) {
      console.error('[❌ ERROR] Failed to register commands:', error);
      return message.reply('❌ Failed to register commands. Check console logs.');
    }
  },
};
