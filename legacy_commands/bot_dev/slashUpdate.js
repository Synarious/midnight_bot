const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Bot owner's user ID
const OWNER_ID = '134118092082118657';

// Legacy command that updates slash commands for the current guild
module.exports = {
    name: 'slash',
    description: 'Updates slash commands for this guild (syncs them instantly)',
    
    async execute(message, args, client) {
        // Only allow the bot owner to use this command
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Only the bot owner can use this command.');
        }

        const clientId = client.user.id;
        const guildId = message.guild.id;

        // Send initial status message
        const statusMsg = await message.channel.send('🔄 Syncing slash commands for this guild...');

        const commands = [];
        const commandsPath = path.join(__dirname, '..');

        // Recursive function to find all command files
        function findCommandFiles(directory) {
            const files = fs.readdirSync(directory, { withFileTypes: true });

            for (const file of files) {
                const filePath = path.join(directory, file.name);
                if (file.isDirectory()) {
                    findCommandFiles(filePath);
                } else if (file.name.endsWith('.js')) {
                    try {
                        const command = require(filePath);
                        if ('data' in command && 'execute' in command) {
                            commands.push(command.data.toJSON());
                        }
                    } catch (error) {
                        console.error(`[ERROR] Failed to load command file at ${filePath}:`, error);
                    }
                }
            }
        }

        try {
            // Find and load all commands
            findCommandFiles(commandsPath);
            
            const rest = new REST().setToken(client.token);

            // Deploy commands to the guild
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );

            await statusMsg.edit(`✅ Successfully registered ${commands.length} slash commands for **${message.guild.name}**!\n*(These commands are now available instantly in this server)*`);
            
        } catch (error) {
            console.error('[ERROR] Failed to update guild commands:', error);
            await statusMsg.edit('❌ Failed to update slash commands. Check console for details.');
        }
    },
};