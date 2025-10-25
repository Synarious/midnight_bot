const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const AlexFlipnote = require('alexflipnote.js');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Sends a random cat image.'),

  async execute(interaction) {
    try {
      const apiKey = process.env.ALEXFLIPNOTE_API_KEY;
      const alex = new AlexFlipnote({ key: apiKey });
      const data = await alex.cats();
      const catEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Random Cat 🐱')
        .setImage(data.file)
        .setDescription('Here’s a cute cat for you!')
        .setTimestamp()
        .setFooter({ text: 'Powered by AlexFlipnote' });

  await interaction.reply({ embeds: [catEmbed] });
    } catch (error) {
      console.error('❌ Error in cat command:', error);
  await interaction.reply({ content: 'An error occurred while fetching the cat image.', flags: MessageFlags.Ephemeral });
    }
  },

  // Rate limit: 4 seconds (API call)
  rateLimit: 4000,
};
