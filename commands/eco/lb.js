const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
  data: new SlashCommandBuilder().setName('lb').setDescription("Leaderboard: everyone's bank in this server"),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });

  // Enforce rate limiting for slash command usage
  const rl = rateLimiter.checkRateLimit(interaction.user.id, 'lb', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/lb');

  try {
      const { rows } = await db.query('SELECT user_id, bank FROM guild_economy WHERE guild_id = $1 ORDER BY bank DESC LIMIT 25', [guildId], { rateKey: guildId, context: 'eco:lb' });

      if (!rows || rows.length === 0) return interaction.reply({ content: 'No economy data for this server yet.' });

      const fields = [];
      for (const [i, r] of rows.entries()) {
        const memberTag = `<@${r.user_id}>`;
        fields.push({ name: `#${i + 1} ${memberTag}`, value: `$${Number(r.bank || 0)}`, inline: false });
      }

      const embed = new EmbedBuilder().setTitle('🏦 Bank Leaderboard').addFields(fields).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('lb error', error);
      await interaction.reply({ content: 'Failed to build leaderboard.', ephemeral: true });
    }
  },

  rateLimit: 5000,
};
