const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const alex = require('alexflipnote.js');
const db = require('../../data/database.js'); // Correct relative path

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Sends a random dog image.'),

  async execute(interaction) {
    try {
      const dogImage = await alex.dog(); // Fetch a random dog image
      const dogEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Random Dog 🐶')
        .setImage(dogImage)
        .setDescription('Here’s a cute dog for you!')
        .setTimestamp()
        .setFooter({ text: 'Powered by alexflipnote.js' });

      await interaction.reply({ embeds: [dogEmbed] });
    } catch (error) {
      console.error('❌ Error in dog command:', error);
      await interaction.reply({ content: 'An error occurred while fetching the dog image.', ephemeral: true });
    }
  },
};
