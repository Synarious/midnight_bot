const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config(); // To load your environment variables

// --- Environment Variables ---
// Make sure to add these to your .env file!
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID; // Discord application ID
// Note: guildId is no longer needed as we're deploying commands globally

/* Global vs Guild Commands
 * ----------------------
 * Global commands:
 * - Available in all servers
 * - Take up to 1 hour to update
 * - Best for production
 * 
 * Guild-specific commands (for testing):
 * - Only available in specific servers
 * - Update instantly
 * - Use Routes.applicationGuildCommands(clientId, guildId) instead
 */
const commands = [];
// --- REVISED: Slash Command Loader ---
// This function will reliably find and validate slash commands, even in nested subfolders.
function findSlashCommands(directory, commandArray, seenNames = new Set()) {
    const files = fs.readdirSync(directory, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(directory, file.name);
        if (file.isDirectory()) {
            findSlashCommands(filePath, commandArray, seenNames); // Recurse into subdirectories
        } else if (file.name.endsWith('.js')) {
            try {
                const command = require(filePath);
                if (!command) continue;

                const isSlash = command.data?.name && typeof command.execute === 'function';
                const isLegacy = command.name && typeof command.execute === 'function' && !command.data;

                if (!isSlash) {
                    if (isLegacy) {
                        console.log(`[SKIP] Legacy/prefix command skipped during slash deployment: ${command.name} (${filePath})`);
                    } else {
                        console.warn(`[WARN] Command at ${filePath} is missing slash command properties; skipping.`);
                    }
                    continue;
                }

                if (!command.data?.description) {
                    console.warn(`[WARN] Slash command '${command.data.name}' at ${filePath} is missing a description; skipping.`);
                    continue;
                }

                // Check for duplicate command names
                if (seenNames.has(command.data.name)) {
                    console.error(`[ERROR] Duplicate command name '${command.data.name}' at ${filePath}`);
                    continue;
                }

                seenNames.add(command.data.name);
                commandArray.push(command.data.toJSON());
                console.log(`[INFO] Loaded slash command: ${command.data.name}`);
            } catch (error) {
                console.error(`[ERROR] Failed to load command file at ${filePath}:`, error);
            }
        }
    }
}

// Only load slash commands from the commands directory
const slashCommandsPath = path.join(__dirname, 'commands');
findSlashCommands(slashCommandsPath, commands);
// --- End of revised section ---

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
	try {
        // --- Clear and update global commands ---
        console.log(`[DEPLOY] Registering ${commands.length} application (/) commands globally`);
        
        // This registers commands globally across all guilds
        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log(`[SUCCESS] Successfully registered ${data.length} global application (/) commands`);
        console.log('[INFO] Note: Global commands can take up to 1 hour to update across all servers');
	} catch (error) {
		console.error('[FATAL] Failed to deploy commands:', error);
	}
})();
