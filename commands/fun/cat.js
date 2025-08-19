const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const alex = require('alexflipnote.js');
const db = require('../../data/database.js'); // Correct relative path

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Sends a random cat image.'),

  async execute(interaction) {
    try {
      const catImage = await alex.cat(); // Fetch a random cat image
      const catEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Random Cat 🐱')
        .setImage(catImage)
        .setDescription('Here’s a cute cat for you!')
        .setTimestamp()
        .setFooter({ text: 'Powered by alexflipnote.js' });

      await interaction.reply({ embeds: [catEmbed] });
    } catch (error) {
      console.error('❌ Error in cat command:', error);
      await interaction.reply({ content: 'An error occurred while fetching the cat image.', ephemeral: true });
    }
  },
};
