const { SlashCommandBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give money to another member')
    .addUserOption(opt => opt.setName('target').setDescription('Member to give to').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to give').setRequired(true)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const target = interaction.options.getUser('target');
    const amount = interaction.options.getInteger('amount');

    if (!guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    if (!target) return interaction.reply({ content: 'Specify a target.', ephemeral: true });
    if (target.id === userId) return interaction.reply({ content: 'You cannot give to yourself.', ephemeral: true });
    if (!Number.isInteger(amount) || amount <= 0) return interaction.reply({ content: 'Specify a positive amount.', ephemeral: true });

  // Enforce rate limiting for slash command usage (commandHandler will handle the prefix-adapter path)
  const rl = rateLimiter.checkRateLimit(userId, 'give', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/give');
    try {
      // Check sender balance
      const { rows: senderRows } = await db.query('SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId], { rateKey: guildId, context: 'eco:give:select_sender' });
      const sender = senderRows[0] || { wallet: 0, bank: 0 };

      if (Number(sender.wallet || 0) < amount) return interaction.reply({ content: 'You do not have enough in your wallet to give.', ephemeral: true });

      await db.query('BEGIN', [], { rateKey: guildId, context: 'eco:give:tx' });
      try {
        await db.query(
          `UPDATE guild_economy SET wallet = GREATEST(0, wallet - $1), updated_at = NOW() WHERE guild_id = $2 AND user_id = $3`,
          [amount, guildId, userId],
          { rateKey: guildId, context: 'eco:give:update_sender' }
        );

        await db.query(
          `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = guild_economy.wallet + $3, updated_at = NOW()`,
          [guildId, target.id, amount, 0],
          { rateKey: guildId, context: 'eco:give:update_target' }
        );

        await db.query('COMMIT', [], { rateKey: guildId, context: 'eco:give:commit' });
      } catch (err) {
        await db.query('ROLLBACK', [], { rateKey: guildId, context: 'eco:give:rollback' });
        throw err;
      }

      await interaction.reply({ content: `🤝 You gave $${amount} to ${target.username}.` });
    } catch (error) {
      console.error('give error', error);
      await interaction.reply({ content: 'Failed to give money.', ephemeral: true });
    }
  },

  // 5 minute rate limit
  rateLimit: 5 * 60 * 1000,
};
