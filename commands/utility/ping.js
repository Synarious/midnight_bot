const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const db = require('../../data/database.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Shows the bot latency and system status.'),

  async execute(interaction) {
    try {
      // Measure roundtrip latency
      const roundTrip = Date.now() - interaction.createdTimestamp;

      // Bot system stats
      const uptime = process.uptime();
      const memUsage = process.memoryUsage().rss / 1024 / 1024;
      const wsPing = interaction.client.ws.ping;

      const formatUptime = (seconds) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs}h ${mins}m ${secs}s`;
      };

      // Create the embed for bot and system status
      const statusEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Bot & System Status')
        .addFields(
          { name: '🤖 Bot Status', value: `📡 API Latency: \`${wsPing}ms\`\n📨 Roundtrip Latency: \`${roundTrip}ms\`\n🟢 Status: \`Online\`\n` },
          { name: '🖥️ System Status', value: `🕒 Uptime: \`${formatUptime(uptime)}\`\n💾 RAM Usage: \`${memUsage.toFixed(2)} MB\`\n🧠 Platform: \`${os.platform()} (${os.arch()})\`\n` }
        )
        .setTimestamp()
        .setFooter({ text: 'System & Bot Health' });

      // Send the response
      await interaction.reply({ embeds: [statusEmbed] });
    } catch (error) {
      console.error('❌ Error in ping command:', error);
      await interaction.reply({ 
        content: 'An error occurred while showing the ping stats.',
        ephemeral: true 
      });
    }
  },
};