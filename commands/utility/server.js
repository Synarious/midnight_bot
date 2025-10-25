const {
	SlashCommandBuilder,
	MessageFlags,
	EmbedBuilder,
} = require('discord.js');
const os = require('os');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Displays system status info.'),
	async execute(interaction) {
		await interaction.deferReply();

		const uptime = process.uptime(); // in seconds
		const memUsage = process.memoryUsage().rss / 1024 / 1024; // MB
		const platform = os.platform();
		const arch = os.arch();

		const formatUptime = (seconds) => {
			const hrs = Math.floor(seconds / 3600);
			const mins = Math.floor((seconds % 3600) / 60);
			const secs = Math.floor(seconds % 60);
			return `${hrs}h ${mins}m ${secs}s`;
		};

		const embed = new EmbedBuilder()
			.setTitle('🖥️ System Status')
			.setColor(0x5865F2)
			.addFields(
				{ name: 'Uptime', value: `\`${formatUptime(uptime)}\``, inline: true },
				{ name: 'RAM Usage', value: `\`${memUsage.toFixed(2)} MB\``, inline: true },
				{ name: 'Platform', value: `\`${platform} (${arch})\``, inline: true },
			);

		await interaction.editReply({
			embeds: [embed],
			flags: MessageFlags.IsComponentsV2,
		});
	},


  // Rate limit: 2 seconds 
  rateLimit: 2000,
};
