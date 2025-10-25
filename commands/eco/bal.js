const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bal')
    .setDescription('Show your wallet and bank balances')
    .addUserOption(opt => opt.setName('user').setDescription('Show someone else\'s balance').setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });

    const target = interaction.options.getUser('user') || interaction.user;
    const userId = target.id;

  // Enforce rate limiting for slash command usage
  const rl = rateLimiter.checkRateLimit(target.id === interaction.user.id ? interaction.user.id : target.id, 'bal', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/bal');

  try {
      const { rows } = await db.query(
        'SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2',
        [guildId, userId],
        { rateKey: guildId, context: 'eco:bal' }
      );

      const row = rows[0] || { wallet: 0, bank: 0 };

      const embed = new EmbedBuilder()
        .setTitle(`${target.username}'s Balance`)
        .addFields(
          { name: 'Wallet', value: `$${Number(row.wallet ?? 0)}`, inline: true },
          { name: 'Bank', value: `$${Number(row.bank ?? 0)}`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('bal error', error);
      await interaction.reply({ content: 'Failed to fetch balance.', ephemeral: true });
    }
  },

  rateLimit: 1000,
};
