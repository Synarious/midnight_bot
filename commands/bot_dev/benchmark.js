const { EmbedBuilder } = require('discord.js');
const database = require('../../data/database.js');
const dbBackup = require('../../modules/dbBackup.js');

const MAX_ITERATIONS = 25;
const DEFAULT_ITERATIONS = 5;

function parseIterations(raw) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_ITERATIONS;
  }
  return Math.min(parsed, MAX_ITERATIONS);
}

function computeStats(durations) {
  if (!durations.length) {
    return { avg: 0, min: 0, max: 0, total: 0 };
  }
  const total = durations.reduce((acc, value) => acc + value, 0);
  const avg = total / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  return { avg, min, max, total };
}

function formatStats({ avg, min, max, total }, successfulRuns, failures) {
  if (successfulRuns === 0) {
    return failures > 0
      ? `• ⚠️ all ${failures} attempts failed`
      : '• no successful measurements';
  }

  const lines = [
    `• avg: ${avg.toFixed(2)} ms`
      + ` (min ${min.toFixed(2)} / max ${max.toFixed(2)})`,
    `• total: ${total.toFixed(2)} ms over ${successfulRuns} runs`,
  ];
  if (failures > 0) {
    lines.push(`• ⚠️ failures: ${failures}`);
  }
  return lines.join('\n');
}

async function runScenario({ label, iterations, runner }) {
  const durations = [];
  let failures = 0;
  const errors = new Map();

  for (let i = 0; i < iterations; i += 1) {
    const startedAt = process.hrtime.bigint();
    try {
      await runner(i);
      const finishedAt = process.hrtime.bigint();
      const diffMs = Number(finishedAt - startedAt) / 1e6;
      durations.push(diffMs);
    } catch (error) {
      failures += 1;
      console.error(`[benchmark] Scenario '${label}' failed on iteration ${i + 1}:`, error);
      const key = error && error.message ? error.message : 'Unknown error';
      errors.set(key, (errors.get(key) || 0) + 1);
    }
  }

  return {
    label,
    durations,
    failures,
    stats: computeStats(durations),
    iterations,
    errors,
  };
}

module.exports = {
  name: 'benchmark',
  description: 'Simulates common database operations to gauge performance (bot owner only).',
  usage: '!benchmark [iterations]',

  async execute(message, args) {
    let ownerId;
    try {
      ownerId = dbBackup.getOwnerId();
    } catch (error) {
      console.error('[benchmark] Failed to resolve BOT_OWNER_ID:', error);
      return message.reply('❌ BOT_OWNER_ID is not configured.');
    }

    if (message.author.id !== ownerId) {
      return message.reply('❌ Only the bot owner can run this command.');
    }

    const iterations = parseIterations(args?.[0]);

    const guildIds = Array.from(new Set(
      message.client.guilds?.cache?.map((guild) => guild.id) || []
    ));

    if (guildIds.length === 0) {
      return message.reply('⚠️ No guilds are cached; unable to run database benchmark.');
    }

    try {
      await database.ensureSchemaReady();
    } catch (error) {
      console.error('[benchmark] Failed to prepare database before benchmarking:', error);
      return message.reply('❌ Could not connect to the database to run benchmarks. Check logs.');
    }

    const statusMessage = await message.reply('🧪 Running database benchmark...');

    const sampledGuilds = guildIds.slice(0, Math.max(1, Math.min(guildIds.length, 10)));

    const scenarios = [
      {
        label: 'Guild settings cache miss',
        iterations,
        runner: async (index) => {
          const guildId = sampledGuilds[index % sampledGuilds.length];
          database.invalidateGuildSettings(guildId);
          await database.getGuildSettings(guildId);
        },
      },
      {
        label: 'Guild settings cache hit',
        iterations,
        runner: async (index) => {
          const guildId = sampledGuilds[index % sampledGuilds.length];
          await database.getGuildSettings(guildId);
        },
      },
      {
        label: 'Filtered message count query',
        iterations,
        runner: async (index) => {
          const guildId = sampledGuilds[index % sampledGuilds.length];
          await database.query(
            'SELECT COUNT(*) FROM filtered_messages WHERE guild_id = $1',
            [guildId],
            { context: 'benchmark:filtered_count', skipLogging: true }
          );
        },
      },
      {
        label: 'Recent invites fetch',
        iterations,
        runner: async (index) => {
          const guildId = sampledGuilds[index % sampledGuilds.length];
          await database.query(
            `SELECT invite_code, uses_count, created_at
             FROM invite_log
             WHERE guild_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [guildId],
            { context: 'benchmark:invite_recent', skipLogging: true }
          );
        },
      },
    ];

    const results = [];
    for (const scenario of scenarios) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runScenario(scenario);
      results.push(outcome);
    }

    const totalRuntime = results.reduce((acc, scenario) => acc + scenario.stats.total, 0);
    const totalErrors = results.reduce((acc, scenario) => acc + scenario.failures, 0);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Database Benchmark Results')
      .setDescription([
        `• iterations per scenario: **${iterations}**`,
        `• sampled guilds: **${sampledGuilds.length}** (showing up to 10)`,
        `• total runtime: **${totalRuntime.toFixed(2)} ms**`,
        totalErrors > 0 ? `• ⚠️ total failures: **${totalErrors}** (see console)` : null,
      ].filter(Boolean).join('\n'))
      .addFields(
        results.map((result) => {
          const successfulRuns = Math.max(0, result.iterations - result.failures);
          const base = formatStats(result.stats, successfulRuns, result.failures);
          const errorLines = [];
          if (result.failures > 0 && result.errors.size > 0) {
            const sample = Array.from(result.errors.entries()).slice(0, 2)
              .map(([messageText, count]) => `• ${messageText}${count > 1 ? ` (x${count})` : ''}`);
            errorLines.push(...sample);
            if (result.errors.size > 2) {
              errorLines.push(`• …and ${result.errors.size - 2} more unique error${result.errors.size - 2 === 1 ? '' : 's'}`);
            }
          }

          return {
            name: result.label,
            value: [base, ...errorLines].filter(Boolean).join('\n'),
            inline: false,
          };
        }),
      )
      .setFooter({ text: 'Benchmarks simulate real command workloads (read-only)' })
      .setTimestamp();

    await statusMessage.edit({ content: null, embeds: [embed] });
  },
};
