require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, Events } = require('discord.js');

/**
 * @type {import('discord-api-types/v10').APIUser}
 */

console.log('[BOOT] Starting bot...');

// --- Module Imports ---
const impersonationCheck = require('./modules/impersonationCheck.js');
const muteHandler = require('./modules/muteHandler.js');
const inviteTracker = require('./modules/inviteTracker.js');
const dbBackup = require('./modules/dbBackup.js');
const token = process.env.DISCORD_TOKEN;
const database = require('./data/database.js');
const commandHandler = require('./events/commandHandler.js');


// --- Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages, GatewayIntentBits.DirectMessageReactions, GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.GuildScheduledEvents, GatewayIntentBits.AutoModerationConfiguration, GatewayIntentBits.AutoModerationExecution
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.botStorage = database;
client.commands = new Collection(); // Legacy commands (prefix-based)
client.slashCommands = new Collection(); // Slash commands

// --- Dynamic Loader Setup ---
console.log('[LOADER] Initializing loaders...');

// Command Loader
commandHandler.loadCommands(client);

// Event Loader
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
        console.error(`[ERROR] [Loader] Failed to read event directory ${dirPath}:`, err);
    }
    return arrayOfFiles;
}

console.log('[LOADER] Loading application events...');
const eventsPath = path.join(__dirname, 'events');
const eventFiles = getAllEventFiles(eventsPath);
for (const filePath of eventFiles) {
    try {
        const event = require(filePath);
        if (!event.name || typeof event.execute !== 'function') {
            console.warn(`[WARN] [Loader] Skipping invalid event file: ${filePath}`);
            continue;
        }
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client).catch(err => {
                console.error(`[ERROR] Event "${event.name}" (once) failed:`, err);
            }));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client).catch(err => {
                console.error(`[ERROR] Event "${event.name}" failed:`, err);
            }));
        }
        console.log(`  └─ [Event] Loaded: ${event.name}`);
    } catch (err) {
        console.error(`[ERROR] [Loader] Failed to load event file ${filePath}:`, err);
    }
}
console.log('[LOADER] Finished loading application events.');

// --- Custom Module Setup ---
console.log('[MODULES] Registering custom module event listeners...');

client.on('guildCreate', database.onGuildCreate);

client.once(Events.ClientReady, async c => {
    console.log(`[READY] Client is ready! Logged in as ${c.user.tag}`);
    console.log('[READY] Performing post-login initializations...');

    try {
        impersonationCheck.initialize(c);
        console.log('  └─ [Module] Initialized: Impersonation Checker');
    } catch (e) {
        console.error('  └─ [ERROR] Failed to initialize Impersonation Checker:', e);
    }
    try {
        muteHandler.initialize(c);
        console.log('  └─ [Module] Initialized: Mute Handler');
    } catch (e) {
        console.error('  └─ [ERROR] Failed to initialize Mute Handler:', e);
    }
    try {
        inviteTracker.initialize(c);
        console.log('  └─ [Module] Initialized: Invite Tracker');
    } catch (e) {
        console.error('  └─ [ERROR] Failed to initialize Invite Tracker:', e);
    }
    try {
        await dbBackup.initialize(c);
        console.log('  └─ [Module] Initialized: Database Backup Scheduler');
    } catch (e) {
        console.error('  └─ [ERROR] Failed to initialize Database Backup Scheduler:', e);
    }
});

client.on(Events.UserUpdate, (oldUser, newUser) => {
    impersonationCheck[Events.UserUpdate].execute(oldUser, newUser, client);
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    impersonationCheck[Events.GuildMemberUpdate].execute(oldMember, newMember);
});

client.on(Events.GuildMemberAdd, member => {
    impersonationCheck[Events.GuildMemberAdd].execute(member);
    muteHandler.handleMemberJoin(member);
    inviteTracker.handleMemberJoin(member);
});

client.on(Events.GuildMemberRemove, member => {
    impersonationCheck[Events.GuildMemberRemove].execute(member);
    inviteTracker.handleMemberLeave(member);
});

client.on(Events.InviteCreate, invite => {
    inviteTracker.handleInviteCreate(invite);
});

client.on(Events.GuildCreate, guild => {
    inviteTracker.handleGuildCreate(guild);
});

client.on('messageCreate', (message) => {
    commandHandler.execute(client, message);
});

console.log('[MODULES] Finished registering custom modules.');

// --- Client Login ---
(async () => {
    try {
        console.log('[LOGIN] Logging into Discord...');
        await client.login(token);
        console.log('[LOGIN] Login successful.');
    } catch (err) {
        console.error('[FATAL] Bot startup failed:', err);
        process.exit(1);
    }
})();