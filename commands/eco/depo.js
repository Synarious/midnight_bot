const { SlashCommandBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('depo')
    .setDescription('Deposit money from your wallet into your bank')
  .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to deposit (omit to deposit all)').setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const amount = interaction.options.getInteger('amount');

    if (!guildId) return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });

  // Enforce rate limiting for slash command usage (commandHandler will handle the prefix-adapter path)
  const rl = rateLimiter.checkRateLimit(userId, 'depo', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/depo');
    try {
      // Load current balances
      const { rows } = await db.query('SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId], { rateKey: guildId, context: 'eco:depo:select' });
      const row = rows[0] || { wallet: 0, bank: 0 };

      // Default to depositing the entire wallet when the option is omitted or -1 is provided
      let deposit;
      if (amount === null || amount === undefined || amount === -1) {
        deposit = Number(row.wallet || 0);
      } else {
        deposit = amount;
      }
      if (!Number.isInteger(deposit) || deposit <= 0) return interaction.reply({ content: 'Specify a positive amount to deposit (or omit to deposit all).', ephemeral: true });
      if (deposit > Number(row.wallet || 0)) return interaction.reply({ content: 'You do not have that much in your wallet.', ephemeral: true });

      await db.query(
        `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = guild_economy.wallet - $3, bank = guild_economy.bank + $3, updated_at = NOW()`,
        [guildId, userId, deposit, 0],
        { rateKey: guildId, context: 'eco:depo:update' }
      );

      await interaction.reply({ content: `🏦 Deposited $${deposit} into your bank.` });
    } catch (error) {
      console.error('depo error', error);
      await interaction.reply({ content: 'Failed to deposit funds.', ephemeral: true });
    }
  },

  rateLimit: 2000,
};
