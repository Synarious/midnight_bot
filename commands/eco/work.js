const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work to earn money (adds to wallet)')
    // Removed required amount option to allow random payout
    // .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to earn').setRequired(true)),
    ,

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
      const supplied = interaction.options.getInteger('amount');
      const amount = Number.isInteger(supplied) && supplied > 0 ? supplied : Math.floor(Math.random() * (500 - 100 + 1)) + 100;

  if (!guildId) return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
  if (!Number.isInteger(amount) || amount <= 0) return interaction.reply({ content: 'Specify a positive amount.', ephemeral: true });

  // Enforce rate limiting for slash command usage (commandHandler will handle the prefix-adapter path)
  const rl = rateLimiter.checkRateLimit(userId, 'work', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/work');
    try {
        const messages = [
          'You worked hard and completed a big project!',
          'You pulled a double shift and earned some cash.',
          'You freelanced for a client and got paid.',
          'You flipped some items and made a profit.',
          'You took on extra hours and boosted your wallet.'
        ];

        const message = messages[Math.floor(Math.random() * messages.length)];
      // Ensure row exists and increment wallet
      await db.query(
        `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = guild_economy.wallet + $3, updated_at = NOW()`,
        [guildId, userId, amount, 0],
        { rateKey: guildId, context: 'eco:work' }
      );

        await interaction.reply({ content: `💼 ${message} You earned $${amount} and it has been added to your wallet.` });
    } catch (error) {
      console.error('work error', error);
      await interaction.reply({ content: 'An error occurred while processing your work.', ephemeral: true });
    }
  },

  // Default rate limit: 5 minutes (can be adjusted)
  rateLimit: 5 * 60 * 1000,
};
