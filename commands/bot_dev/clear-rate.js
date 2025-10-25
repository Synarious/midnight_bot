const { SlashCommandBuilder } = require('discord.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear-rate')
    .setDescription('[Owner Only] Clear rate limits for a user')
    .addStringOption(opt => opt.setName('user').setDescription('User ID or mention').setRequired(true)),

  async execute(interaction) {
    const ownerId = process.env.BOT_OWNER_ID || process.env.OWNER_ID;
    if (!ownerId) {
      return interaction.reply({ content: '⚠️ BOT_OWNER_ID not configured.', ephemeral: true });
    }
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: '❌ This command is only available to the bot owner.', ephemeral: true });
    }

    const userArg = interaction.options.getString('user');
    const idMatch = userArg.match(/^<@!?(\d+)>$|^(\d+)$/);
    const userId = idMatch ? (idMatch[1] || idMatch[2]) : null;
    if (!userId) {
      return interaction.reply({ content: '❌ Invalid user. Provide a mention or user ID.', ephemeral: true });
    }

    const cleared = rateLimiter.clearUserRateLimits(userId);
    if (cleared) {
      return interaction.reply({ content: `✅ Cleared rate limits for <@${userId}> (${userId}).`, ephemeral: true });
    }

    return interaction.reply({ content: `⚠️ No active rate limits found for <@${userId}>.`, ephemeral: true });
  },

  // Owner-only utility
  rateLimit: 0,
};
