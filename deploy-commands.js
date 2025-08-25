const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config(); // To load your environment variables

// --- Environment Variables ---
// Make sure to add these to your .env file!
const token = process.env.TOKEN;
const clientId = process.env.clientId;
const guildId = process.env.guildId; // The ID of the server where you want to test commands
const commands = [];
// --- REVISED: Recursive Command Loader ---
// This function will reliably find every command file, even in nested subfolders.
function findCommandFiles(directory, commandArray) {
    const files = fs.readdirSync(directory, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(directory, file.name);
        if (file.isDirectory()) {
            findCommandFiles(filePath, commandArray); // Recurse into subdirectories
        } else if (file.name.endsWith('.js')) {
            try {
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    commandArray.push(command.data.toJSON());
                    console.log(`[INFO] Loaded command from: ${filePath}`);
                } else {
                    console.warn(`[WARN] The command at ${filePath} is missing a required "data" or "execute" property.`);
                }
            } catch (error) {
                console.error(`[ERROR] Failed to load command file at ${filePath}:`, error);
            }
        }
    }
}

findCommandFiles(path.join(__dirname, 'commands'), commands);
// --- End of revised section ---

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
	try {
        // --- Clear existing commands ---
        console.log(`[DEPLOY] Clearing all existing application (/) commands for guild: ${guildId}`);
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: [] },
        );
        console.log('[SUCCESS] Successfully cleared all guild commands.');
        
        // --- Register new commands ---
		console.log(`[DEPLOY] Started refreshing ${commands.length} application (/) commands for guild: ${guildId}`);
		const data = await rest.put(
			Routes.applicationGuildCommands(clientId, guildId),
			{ body: commands },
		);

		console.log(`[SUCCESS] Successfully reloaded ${data.length} application (/) commands for the test guild.`);
	} catch (error) {
		console.error('[FATAL] Failed to deploy commands:', error);
	}
})();
