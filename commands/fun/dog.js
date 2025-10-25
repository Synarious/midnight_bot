const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const AlexFlipnote = require('alexflipnote.js');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Sends a random dog image.'),

  async execute(interaction) {
    try {
      const apiKey = process.env.ALEXFLIPNOTE_API_KEY;
      const alex = new AlexFlipnote({ key: apiKey });
      const data = await alex.dogs();
      const dogEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Random Dog 🐶')
        .setImage(data.file)
        .setDescription('Here’s a cute dog for you!')
        .setTimestamp()
        .setFooter({ text: 'Powered by AlexFlipnote' });

  await interaction.reply({ embeds: [dogEmbed] });
    } catch (error) {
      console.error('❌ Error in dog command:', error);
  await interaction.reply({ content: 'An error occurred while fetching the dog image.', flags: MessageFlags.Ephemeral });
    }
  },

  // Rate limit: 4 seconds (API call)
  rateLimit: 4000,
};
