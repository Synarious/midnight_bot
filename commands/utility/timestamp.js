const { SlashCommandBuilder } = require('discord.js');
const { add } = require('date-fns');

// Create the slash command
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Generates a Discord timestamp from a human-readable time or date.')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('The time or date to convert to a timestamp (e.g., "in 3 days" or "July 4, 2025")')
        .setRequired(true)),

  // Execute the slash command
  async execute(interaction) {
    const command = interaction.options.getString('time').trim();

    try {
      let targetDate;

      // Check if it's a relative time (like "in 3 days")
      if (command.startsWith('in')) {
        const parts = command.split(' '); // Split into ['in', '3', 'days']
        const quantity = parseInt(parts[1]);
        const unit = parts[2];

        // Add the specified time to the current date
        targetDate = add(new Date(), { [unit]: quantity });
      } else {
        // Otherwise, parse the human-readable date
        targetDate = new Date(command);
      }

      // Check if the date is valid
      if (isNaN(targetDate)) {
        return interaction.reply('Sorry, I couldn\'t understand that date.');
      }

      // Convert to timestamp
      const timestamp = Math.floor(targetDate.getTime() / 1000);

      // Format into Discord timestamp
      const discordTimestamp = `<t:${timestamp}:R>`; // Use `R` for relative time

      // Reply with the Discord timestamp
      return interaction.reply(discordTimestamp);
    } catch (error) {
      console.error('Error processing the date:', error);
      return interaction.reply('Sorry, there was an error processing that time!');
    }
  },
};
