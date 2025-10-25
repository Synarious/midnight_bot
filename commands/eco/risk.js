const { SlashCommandBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder().setName('risk').setDescription('Take a risky action for higher payout'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    if (!guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });

  // Enforce rate limiting for slash command usage (commandHandler will handle the prefix-adapter path)
  const rl = rateLimiter.checkRateLimit(userId, 'risk', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/risk');
    try {
      const payout = randomInt(100, 1000);
      const success = Math.random() < 0.55; // ~55% success

      const { rows } = await db.query('SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId], { rateKey: guildId, context: 'eco:risk:select' });
      const row = rows[0] || { wallet: 0, bank: 0 };

      if (success) {
        await db.query(
          `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = guild_economy.wallet + $3, updated_at = NOW()`,
          [guildId, userId, payout, 0],
          { rateKey: guildId, context: 'eco:risk:win' }
        );

        await interaction.reply({ content: `🎲 You took a risk and won $${payout}!` });
      } else {
        const walletPenalty = Math.floor(Number(row.wallet || 0) * 0.15);
        const bankPenalty = Math.floor(Number(row.bank || 0) * 0.10);
        const penalty = Math.max(walletPenalty, bankPenalty, 0);

        if (penalty > 0) {
          const walletAfter = Math.max(0, Number(row.wallet || 0) - penalty);
          const bankAfter = Number(row.bank || 0);

          await db.query(
            `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
             ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = $3, bank = $4, updated_at = NOW()`,
            [guildId, userId, walletAfter, bankAfter],
            { rateKey: guildId, context: 'eco:risk:penalty' }
          );
        }

        await interaction.reply({ content: `❌ You failed and lost $${penalty}.` });
      }
    } catch (error) {
      console.error('risk error', error);
      await interaction.reply({ content: 'Risk failed due to an internal error.', ephemeral: true });
    }
  },

  // 2 hour rate limit
  rateLimit: 2 * 60 * 60 * 1000,
};
