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
    // Unified loader: read only from /commands and adapt slash commands to prefix (!) commands
    const commandsPath = path.join(__dirname, '../commands');

    // Build a lightweight pseudo-interaction to adapt slash command handlers to message-based calls
    function buildPseudoInteraction(message, args, client) {
      // args is an array of strings like ['userId', 'reason part 1', 'reason part 2']
      const argsArr = Array.isArray(args) ? args.slice() : [];

      const pseudo = {};

      const options = {
        _args: argsArr,
        // Try to resolve a user-like object from the first arg using client cache when possible
        getUser: (name) => {
          const first = options._args[0];
          if (!first) return null;
          const idMatch = first.match(/^<@!?(\d+)>$|^(\d+)$/);
          const id = idMatch ? (idMatch[1] || idMatch[2]) : null;
          if (id) {
            const user = client.users?.cache?.get?.(id);
            if (user) return user;
            return { id, tag: `<@${id}>` };
          }
          return null;
        },
        getString: (name) => {
          // If a specific option name is asked (e.g., 'reason'), return joined tail; otherwise pop sequential
          if (name === 'reason') {
            return options._args.length > 1 ? options._args.slice(1).join(' ') : null;
          }
          if (name === 'user_id') {
            return options._args[0] || null;
          }
          // fallback: shift next arg
          return options._args.shift() || null;
        },
        getInteger: () => {
          const v = options.getString();
          return v === null ? null : parseInt(v, 10);
        },
        // Basic stubs for methods some commands may call
        getSubcommand: () => null,
        _deferred: false,
        _deferredMessage: null,
      };

      pseudo.createdTimestamp = message.createdTimestamp;
      pseudo.client = client;
      pseudo.guild = message.guild;
      pseudo.channel = message.channel;
      pseudo.member = message.member;
      pseudo.user = message.author;
      pseudo.commandArgs = argsArr; // Add commandArgs for traditional commands

      pseudo.reply = (content) => message.reply(content);

      pseudo.deferReply = async (opts) => {
        // Simulate deferring by sending a visible placeholder message and marking deferred flag
        options._deferred = true;
        pseudo.deferred = true;
        try {
          const content = (opts && opts.content) || 'Processing...';
          const sent = await message.reply({ content }).catch(() => null);
          options._deferredMessage = sent;
          return;
        } catch (e) {
          return;
        }
      };

      pseudo.editReply = async (payload) => {
        const text = (payload && (payload.content || (typeof payload === 'string' && payload))) || (typeof payload === 'string' ? payload : null);
        pseudo.replied = true;
        try {
          if (options._deferredMessage && typeof options._deferredMessage.edit === 'function') {
            return options._deferredMessage.edit(typeof payload === 'object' && payload.content ? payload.content : String(text || ''));
          }
          // fallback to sending a new message
          return message.reply(typeof payload === 'object' && payload.content ? payload.content : String(text || ''));
        } catch (e) {
          return;
        }
      };

      pseudo.options = options;

      return pseudo;
    }

    function readCommands(dir) {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          readCommands(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

        try {
          const command = require(fullPath);

          // If this file is an old-style legacy command (exports `name`), register as-is
          if (command && typeof command.name === 'string' && typeof command.execute === 'function') {
            if (client.commands.has(command.name)) {
              console.warn(`[⚠️ WARNING] Duplicate legacy command name '${command.name}' at ${fullPath}`);
            } else {
              client.commands.set(command.name, command);
              console.log(`✅ Loaded legacy command: ${command.name}`);
            }
            continue;
          }

          // New-style slash command: must export .data (SlashCommandBuilder) and .execute
          if (command && command.data && typeof command.execute === 'function') {
            const name = command.data.name;
            if (!name) {
              console.warn(`[⚠️ WARNING] Command at ${fullPath} has no name in its data.`);
              continue;
            }

            if (client.slashCommands.has(name)) {
              console.warn(`[⚠️ WARNING] Duplicate slash command name '${name}' at ${fullPath}`);
              continue;
            }

            client.slashCommands.set(name, command);
            console.log(`✅ Loaded slash command: ${name}`);

            // If there isn't an existing legacy mapping, create an adapter so prefix users can run the same command
            if (!client.commands.has(name)) {
              client.commands.set(name, {
                name,
                description: command.data.description || '',
                async execute(message, args, clientRef) {
                  const pseudo = buildPseudoInteraction(message, args, clientRef);
                  // Some commands accept (interaction) only, others (interaction, args)
                  try {
                    const res = command.execute.length > 1 ? await command.execute(pseudo, args) : await command.execute(pseudo);
                    return res;
                  } catch (err) {
                    throw err;
                  }
                },
              });
              console.log(`🔁 Created prefix adapter for command: ${name}`);
            }
            continue;
          }

          console.warn(`[⚠️ WARNING] Command file at ${fullPath} did not match legacy or slash contract.`);
        } catch (err) {
          console.error(`[❌ ERROR] Failed to load command ${fullPath}:`, err);
        }
      }
    }

    console.log('[INFO] Loading commands from /commands (unified loader)...');
    readCommands(commandsPath);
    console.log('[INFO] Command loading complete. Legacy commands folder is no longer required; keep it only for custom legacy-only modules.');
  }
};