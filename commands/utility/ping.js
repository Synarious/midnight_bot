const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const db = require('../../data/database.js'); // Correct relative path

module.exports = {
  // Define the slash command for /ping
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Shows the bot latency and system status.'),

  // Execute the command (Slash Command or Prefix Command)
  async execute(interaction) {
    try {
      // Check if it's a message-based command (not a slash command)
      const isSlashCommand = interaction.isCommand();
      const message = interaction.isCommand() ? interaction : null; // Only for prefix command
      const reply = isSlashCommand ? interaction : message.reply;

      // Fetch the bot's prefix from the database for the current guild (if it's a message command)
      let botPrefix = '!';
      if (!isSlashCommand) {
        const guildId = message.guild.id;
        const settings = db.prepare('SELECT cmd_prefix FROM guild_settings WHERE guild_id = ?').get(guildId);
        botPrefix = settings ? settings.cmd_prefix : '!';
      }

      // Measure roundtrip latency
      const roundTrip = isSlashCommand
        ? Date.now() - interaction.createdTimestamp
        : Date.now() - message.createdTimestamp;

      // Bot system stats
      const uptime = process.uptime(); // in seconds
      const memUsage = process.memoryUsage().rss / 1024 / 1024; // in MB
      const wsPing = interaction.client.ws.ping;

      const formatUptime = (seconds) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs}h ${mins}m ${secs}s`;
      };

      // Create the embed for bot and system status
      const statusEmbed = new MessageEmbed()
        .setColor('#0099ff')
        .setTitle('Bot & System Status')
        .addFields(
          { name: '🤖 Bot Status', value: `📡 API Latency: \`${wsPing}ms\`\n📨 Roundtrip Latency: \`${roundTrip}ms\`\n🟢 Status: \`Online\`\n` },
          { name: '🖥️ System Status', value: `🕒 Uptime: \`${formatUptime(uptime)}\`\n💾 RAM Usage: \`${memUsage.toFixed(2)} MB\`\n🧠 Platform: \`${os.platform()} (${os.arch()})\`\n` },
          { name: '🔑 Bot Command Prefix', value: `Your bot prefix is: \`${botPrefix}\`` }
        )
        .setTimestamp()
        .setFooter({ text: 'System & Bot Health' });

      // Send the response in an embed message
      await reply({ embeds: [statusEmbed] });
    } catch (error) {
      console.error('❌ Error in ping command:', error);
      const errorMsg = 'An error occurred while showing the ping stats.';
      if (isSlashCommand) {
        await interaction.reply({ content: errorMsg, ephemeral: true });
      } else {
        await message.reply({ content: errorMsg, ephemeral: true });
      }
    }
  },
};