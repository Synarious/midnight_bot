const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Replace with your actual user ID (bot owner)
const OWNER_ID = '134118092082118657';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registercommands')
    .setDescription('Manually registers all slash commands for this guild (owner only)'),

  async execute(interaction) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ Only the bot owner can use this command.', ephemeral: true });
    }
    if (message.author.id !== OWNER_ID) {
      return message.reply('❌ Only the bot owner can use this command.');
    }

    const client = interaction.client;
    const clientId = client.user.id;
    const token = client.token;
    const guildId = interaction.guild.id;

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

    await interaction.deferReply({ ephemeral: true });

    const rest = new REST({ version: '10' }).setToken(token);

    try {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ Successfully registered ${commands.length} slash commands to guild ${guildId}.`);
      return interaction.editReply(`✅ Successfully registered ${commands.length} slash commands to **${interaction.guild.name}**.`);
    } catch (error) {
      console.error('[❌ ERROR] Failed to register commands:', error);
      return interaction.editReply('❌ Failed to register commands. Check console logs.');
    }
  },
};
