const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch'); // You may need to install this with npm install node-fetch

module.exports = {
  // Define the slash command for /duck
  data: new SlashCommandBuilder()
    .setName('duck')
    .setDescription('Sends a random picture of a duck!'),

  // Execute the command
  async execute(interaction) {
    try {
      // Fetch random duck image URL from the Random Duck API
      const response = await fetch('https://random-d.uk/api/v1/random');
      const data = await response.json();

      if (!data || !data.url) {
        return interaction.reply({ content: 'Sorry, I couldn\'t fetch a duck image right now!', ephemeral: true });
      }

      // Create an embed for the duck image
      const duckEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Here\'s a random duck!')
        .setImage(data.url)
        .setTimestamp()
        .setFooter({ text: 'Quack! 🦆' });

      // Send the response in an embed message
      await interaction.reply({ embeds: [duckEmbed] });
    } catch (error) {
      console.error('❌ Error in duck command:', error);
      await interaction.reply({ content: 'An error occurred while fetching a duck image.', ephemeral: true });
    }
  },

  // Rate limit: 4 seconds (API call)
  rateLimit: 4000,
};
