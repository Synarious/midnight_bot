const { SlashCommandBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function crimeNarrative(success, amount, victim = null) {
  if (success) {
    const stories = [
      `You pulled off a daring heist and got away with $${amount}.`,
      `You found an unsecured wallet and took $${amount}.`,
      `A shady deal went your way — you made $${amount}.`,
    ];
    return stories[Math.floor(Math.random() * stories.length)];
  }

  const failStories = [
    `The plan failed and you were caught — you lost $${amount}.`,
    `Security was tighter than expected and you were relieved of $${amount}.`,
    `You slipped up and paid $${amount} as consequences.`,
  ];

  return failStories[Math.floor(Math.random() * failStories.length)];
}

module.exports = {
  data: new SlashCommandBuilder().setName('crime').setDescription('Attempt a crime with risk/reward'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    if (!guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });

  // Enforce rate limiting for slash command usage (commandHandler will handle the prefix-adapter path)
  const rl = rateLimiter.checkRateLimit(userId, 'crime', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/crime');
    try {
      // payout 0-500
      const payout = randomInt(0, 500);
      const success = Math.random() < 0.6; // 60% success chance (adjustable)

      // Load balances
      const { rows } = await db.query('SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId], { rateKey: guildId, context: 'eco:crime:select' });
      const row = rows[0] || { wallet: 0, bank: 0 };

      if (success) {
        await db.query(
          `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = guild_economy.wallet + $3, updated_at = NOW()`,
          [guildId, userId, payout, 0],
          { rateKey: guildId, context: 'eco:crime:win' }
        );

        await interaction.reply({ content: `🕵️ ${crimeNarrative(true, payout)}` });
      } else {
        // penalty: max(15% wallet, 10% bank)
        const walletPenalty = Math.floor(Number(row.wallet || 0) * 0.15);
        const bankPenalty = Math.floor(Number(row.bank || 0) * 0.10);
        const penalty = Math.max(walletPenalty, bankPenalty, 0);

        if (penalty > 0) {
          // prefer taking from wallet first
          const walletAfter = Math.max(0, Number(row.wallet || 0) - penalty);
          const bankAfter = Number(row.bank || 0);

          await db.query(
            `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
             ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = $3, bank = $4, updated_at = NOW()`,
            [guildId, userId, walletAfter, bankAfter],
            { rateKey: guildId, context: 'eco:crime:penalty' }
          );
        }

        await interaction.reply({ content: `🚨 ${crimeNarrative(false, penalty)}` });
      }
    } catch (error) {
      console.error('crime error', error);
      await interaction.reply({ content: 'Crime failed due to an internal error.', ephemeral: true });
    }
  },

  // 2 hour rate limit
  rateLimit: 2 * 60 * 60 * 1000,
};
