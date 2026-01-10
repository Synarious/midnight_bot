const fs = require('fs');
const path = require('path');
const db = require('../data/database.js');
const rateLimiter = require('../utils/rateLimiter');

// Default rate limit for prefix commands (3 seconds)
const DEFAULT_PREFIX_RATE_LIMIT = 3000;

module.exports = {
  async execute(client, message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guildId = message.guild.id;

    // Global kill-switch per guild
    try {
      const enabled = await db.isBotEnabled(guildId);
      if (!enabled) return;
    } catch (e) {
      // Fail-open: if DB is down, don't brick the bot.
    }

    // Get prefix from PostgreSQL
    let prefix = '!'; // Default prefix
    try {
      prefix = await db.getGuildPrefix(guildId);
    } catch (err) {
      console.error(`[❌ DATABASE] Failed to get prefix for guild ${guildId}:`, err);
    }

    // Defensive: ensure prefix is a non-empty string. DB may contain empty string which would
    // make every message look like a command (startsWith('') === true).
    if (typeof prefix !== 'string' || prefix.length === 0) {
      prefix = '!';
    }

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Only look for legacy commands in prefix-based messages
    const command = client.commands.get(commandName);

    if (!command) return;

    // Per-command enable/disable toggle (dashboard)
    try {
      const enabled = await db.isGuildCommandEnabled(guildId, commandName);
      if (!enabled) {
        await message.reply('⚠️ This command is disabled on this server.');
        return;
      }
    } catch (e) {
      // fail-open
    }

    // Module-level gating for economy commands
    try {
      const category = (command.category || '').toLowerCase();
      if (category === 'eco' || category.startsWith('eco/')) {
        const econEnabled = await db.isEconomyEnabled(guildId);
        if (!econEnabled) {
          await message.reply('⚠️ The Economy module is disabled on this server.');
          return;
        }
      }
    } catch (e) {
      // fail-open
    }

    // Get rate limit for this command (check if underlying slash command has rateLimit)
    let limitMs = DEFAULT_PREFIX_RATE_LIMIT;
    const slashCommand = client.slashCommands.get(commandName);
    if (slashCommand && slashCommand.rateLimit) {
      limitMs = slashCommand.rateLimit;
    }

  // Check rate limit.
  // If this command is a prefix adapter for a slash command, only perform a non-touching
  // check here so we don't set the timestamp twice (the slash command path will record
  // the usage). For legacy prefix-only commands we still touch the timestamp here.
  const isAdapter = !!slashCommand;
  const rateLimitCheck = rateLimiter.checkRateLimit(message.author.id, commandName, limitMs, isAdapter ? false : true);
    if (rateLimitCheck.limited) {
      const remainingSec = Math.ceil(rateLimitCheck.remainingMs / 1000);
      console.warn(`[commandHandler] Rate limit hit: prefix command=${commandName} | User: ${message.author.tag} (${message.author.id}) | Remaining: ${remainingSec}s`);
      
      await rateLimiter.sendRateLimitResponse(message, rateLimitCheck.remainingMs, commandName);
      return;
    }

    try {
        await command.execute(message, args, client);

        // For prefix adapters (slash command wrappers) we need to record the usage
        // after the command successfully ran. We deferred touching above to avoid
        // an immediate double-hit; now record the timestamp so subsequent calls are
        // rate limited as expected.
        if (isAdapter) {
          try { rateLimiter.touchRateLimit(message.author.id, commandName); } catch (e) { /* best-effort */ }
        }
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
          // For 'reason' prefer the joined remainder, but if there's exactly one arg return it (single-word reason)
          if (name === 'reason') {
            if (options._args.length > 1) return options._args.slice(1).join(' ');
            if (options._args.length === 1) return options._args[0];
            return null;
          }
          if (name === 'user_id') {
            return options._args[0] || null;
          }
          // fallback: shift next arg
          return options._args.shift() || null;
        },
        getInteger: () => {
          const v = options.getString();
          if (v === null) return null;
          const n = parseInt(v, 10);
          return Number.isNaN(n) ? null : n;
        },
        getBoolean: (name) => {
          const argIndex = options._args.findIndex(arg => arg.toLowerCase() === `true` || arg.toLowerCase() === `false`);
          if (argIndex !== -1) {
            const val = options._args[argIndex].toLowerCase() === 'true';
            options._args.splice(argIndex, 1);
            return val;
          }
          return null;
        },
        // Basic stubs for methods some commands may call
        getSubcommand: () => null,
        _deferred: false,
        _deferredMessage: null,
      };

      pseudo.createdTimestamp = message.createdTimestamp;
      pseudo.client = client;
      pseudo.guild = message.guild;
  // Provide guildId like a real Interaction so commands that use interaction.guildId work
  pseudo.guildId = message.guild?.id || null;
      pseudo.channel = message.channel;
      pseudo.member = message.member;
      pseudo.user = message.author;
      pseudo.commandArgs = [...argsArr]; // Add commandArgs for traditional commands (create a copy)

      pseudo.reply = async (payload) => {
        pseudo.replied = true;
        // Handle both object payload and string payload
        if (typeof payload === 'object') {
          return message.reply(payload);
        }
        return message.reply({ content: String(payload) });
      };

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

      pseudo.replied = false;

      pseudo.editReply = async (payload) => {
        pseudo.replied = true;
        try {
          if (options._deferredMessage && typeof options._deferredMessage.edit === 'function') {
            // If payload is an object, ensure embeds are serialized and we don't send empty content
            if (typeof payload === 'object') {
              const editPayload = Object.assign({}, payload);

              // Normalize embeds: convert EmbedBuilder instances to plain JSON
              if (Array.isArray(editPayload.embeds) && editPayload.embeds.length > 0) {
                editPayload.embeds = editPayload.embeds.map(e => (e && typeof e.toJSON === 'function') ? e.toJSON() : e);
              }

              // Remove empty content to avoid the API receiving an empty string
              if (editPayload.content === '' || editPayload.content === null) {
                delete editPayload.content;
              }

              // If there's no content and no embeds, provide a safe fallback message
              if ((!editPayload.content || String(editPayload.content).trim() === '') && (!editPayload.embeds || editPayload.embeds.length === 0)) {
                editPayload.content = 'Response ready';
              }

              return options._deferredMessage.edit(editPayload);
            }

            return options._deferredMessage.edit({ content: String(payload) });
          }

          // fallback to sending a new message
          if (typeof payload === 'object') {
            // Normalize embeds for message.reply as well
            const replyPayload = Object.assign({}, payload);
            if (Array.isArray(replyPayload.embeds) && replyPayload.embeds.length > 0) {
              replyPayload.embeds = replyPayload.embeds.map(e => (e && typeof e.toJSON === 'function') ? e.toJSON() : e);
            }
            // Ensure there is at least content or embeds
            if ((!replyPayload.content || String(replyPayload.content).trim() === '') && (!replyPayload.embeds || replyPayload.embeds.length === 0)) {
              replyPayload.content = 'Response ready';
            }
            return message.reply(replyPayload);
          }

          return message.reply({ content: String(payload) });
        } catch (e) {
          console.error('[Pseudo-interaction] editReply failed:', e);
          console.error('[Pseudo-interaction] Payload was:', (() => {
            try { return JSON.stringify(payload, null, 2); } catch (_) { return String(payload); }
          })());
          return;
        }
      };

      pseudo.options = options;

      return pseudo;
    }

    // Statistics tracking
    const stats = {
      slashCommands: [],
      legacyCommands: [],
      prefixAdapters: [],
      warnings: [],
      errors: []
    };

    function readCommands(dir, categoryPath = '') {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const currentCategory = categoryPath ? `${categoryPath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          readCommands(fullPath, currentCategory);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

        try {
          const command = require(fullPath);

          // If this file is an old-style legacy command (exports `name`), register as-is
          if (command && typeof command.name === 'string' && typeof command.execute === 'function') {
            if (client.commands.has(command.name)) {
              stats.warnings.push(`Duplicate legacy command: ${command.name}`);
            } else {
              try { command.category = categoryPath || ''; } catch (_) {}
              client.commands.set(command.name, command);
              stats.legacyCommands.push({ name: command.name, category: categoryPath });
            }
            continue;
          }

          // New-style slash command: must export .data (SlashCommandBuilder) and .execute
          if (command && command.data && typeof command.execute === 'function') {
            const name = command.data.name;
            if (!name) {
              stats.warnings.push(`Command at ${fullPath} has no name`);
              continue;
            }

            if (client.slashCommands.has(name)) {
              stats.warnings.push(`Duplicate slash command: ${name}`);
              continue;
            }

            client.slashCommands.set(name, command);
            try { command.category = categoryPath || ''; } catch (_) {}
            stats.slashCommands.push({ name, category: categoryPath, hasRateLimit: !!command.rateLimit });

            // If there isn't an existing legacy mapping, create an adapter so prefix users can run the same command
            if (!client.commands.has(name)) {
              client.commands.set(name, {
                name,
                description: command.data.description || '',
                category: categoryPath || '',
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
              stats.prefixAdapters.push(name);
            }
            continue;
          }

          stats.warnings.push(`Invalid command file: ${fullPath}`);
        } catch (err) {
          stats.errors.push({ file: fullPath, error: err.message });
        }
      }
    }

    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│     🤖 Loading Bot Commands...         │');
    console.log('└─────────────────────────────────────────┘\n');
    
    readCommands(commandsPath);
    
    // Print organized results
    console.log('📊 Command Loading Summary:');
    console.log('─'.repeat(45));
    
    // Group slash commands by category
    if (stats.slashCommands.length > 0) {
      console.log('\n✨ Slash Commands:');
      const byCategory = {};
      stats.slashCommands.forEach(cmd => {
        const cat = cmd.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(cmd.name + (cmd.hasRateLimit ? ' ⏱️' : ''));
      });
      
      Object.keys(byCategory).sort().forEach(cat => {
        console.log(`   ${cat.padEnd(15)} → ${byCategory[cat].join(', ')}`);
      });
    }
    
    // Legacy commands
    if (stats.legacyCommands.length > 0) {
      console.log('\n🔧 Legacy Commands:');
      const byCategory = {};
      stats.legacyCommands.forEach(cmd => {
        const cat = cmd.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(cmd.name);
      });
      
      Object.keys(byCategory).sort().forEach(cat => {
        console.log(`   ${cat.padEnd(15)} → ${byCategory[cat].join(', ')}`);
      });
    }
    
    // Summary line
    console.log('\n' + '─'.repeat(45));
    console.log(`✅ Total: ${stats.slashCommands.length} slash + ${stats.legacyCommands.length} legacy`);
    console.log(`🔁 Prefix adapters: ${stats.prefixAdapters.length} created`);
    
    // Warnings
    if (stats.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${stats.warnings.length}):`);
      stats.warnings.forEach(w => console.log(`   • ${w}`));
    }
    
    // Errors
    if (stats.errors.length > 0) {
      console.log(`\n❌ Errors (${stats.errors.length}):`);
      stats.errors.forEach(e => console.log(`   • ${e.file}: ${e.error}`));
    }
    
    console.log('\n' + '═'.repeat(45));
    console.log('✓ Command loading complete!\n');

    return stats;
  }
};