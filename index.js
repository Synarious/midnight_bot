require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const database = require('./data/database.js');
const commandHandler = require('./events/commandHandler.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Attach the database instance to the client
client.botStorage = database;

// Register the guildCreate event listener
client.on('guildCreate', database.onGuildCreate);

// Initialize command collection
client.commands = new Collection();

// Load commands once on startup
commandHandler.loadCommands(client);

// Load Events (supports nested folders)
function getAllEventFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getAllEventFiles(fullPath, arrayOfFiles);
      } else if (file.endsWith('.js')) {
        arrayOfFiles.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`[❌ ERROR] Failed to read event directory ${dirPath}:`, err);
  }
  return arrayOfFiles;
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = getAllEventFiles(eventsPath);

for (const filePath of eventFiles) {
  try {
    const event = require(filePath);

    if (!event.name || typeof event.execute !== 'function') {
      console.warn(`[⚠️ WARNING] Skipping invalid event file: ${filePath}`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args).catch(err => {
        console.error(`[❌ ERROR] Event "${event.name}" (once) failed:`, err);
      }));
    } else {
      client.on(event.name, (...args) => event.execute(...args).catch(err => {
        console.error(`[❌ ERROR] Event "${event.name}" failed:`, err);
      }));
    }
    console.log(`✅ Loaded event: ${event.name}`);
  } catch (err) {
    console.error(`[❌ ERROR] Failed to load event file ${filePath}:`, err);
  }
}

// Attach command handler to messageCreate event
client.on('messageCreate', (message) => {
  commandHandler.execute(client, message);
});

client.login(token)
  .then(() => {
    console.log('✅ Bot logged in successfully.');
  })
  .catch(err => {
    console.error('[❌ ERROR] Bot login failed:', err);
  });