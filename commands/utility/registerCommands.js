// commands/admin/registerCommands.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Replace this with your actual user ID (owner only)
const OWNER_ID = '134118092082118657';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registercommands')
    .setDescription('Manually registers all slash commands for this guild')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Optional: You can restrict by role too

  async execute(interaction) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ Only the bot owner can use this command.',
        ephemeral: true,
      });
    }

    const clientId = interaction.client.user.id;
    const token = interaction.client.token;
    const guildId = interaction.guild.id;

    const commands = [];
    const foldersPath = path.join(__dirname, '..');
    const commandFolders = fs.readdirSync(foldersPath);

    for (const folder of commandFolders) {
      const commandsPath = path.join(foldersPath, folder);
      if (!fs.existsSync(commandsPath)) continue;

      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
          commands.push(command.data.toJSON());
        }
      }
    }

    const rest = new REST().setToken(token);

    try {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );

      return interaction.reply({
        content: `✅ Successfully registered ${commands.length} commands to **${interaction.guild.name}**.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: '❌ Failed to register commands. See logs.',
        ephemeral: true,
      });
    }
  },
};
