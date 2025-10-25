const {
	SlashCommandBuilder,
	MessageFlags,
	EmbedBuilder,
	TextDisplayBuilder,
	ContainerBuilder,
} = require('discord.js');
const os = require('os');
const { execSync } = require('child_process');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('status')
		.setDescription('Shows the bot latency and system status.'),

	async execute(interaction) {
		try {
			await interaction.deferReply();

			// Helper: format uptime seconds to Hh Mm Ss
			const formatUptime = (seconds) => {
				const hrs = Math.floor(seconds / 3600);
				const mins = Math.floor((seconds % 3600) / 60);
				const secs = Math.floor(seconds % 60);
				return `${hrs}h ${mins}m ${secs}s`;
			};

			// Bot uptime (process uptime)
			const botUptimeSec = process.uptime();

			// Bot memory usage (RSS)
			const botMemMB = process.memoryUsage().rss / 1024 / 1024;

			// Bot CPU usage - from process.cpuUsage() (microseconds)
			// Calculate CPU usage percentage over 100ms interval
			const cpuUsageStart = process.cpuUsage();
			const startTime = Date.now();
			await new Promise(resolve => setTimeout(resolve, 100));
			const cpuUsageEnd = process.cpuUsage(cpuUsageStart);
			const elapsedTime = (Date.now() - startTime) * 1000; // microseconds

			// CPU percentage = (user+system cpu time) / elapsedTime
			const botCpuPercent = ((cpuUsageEnd.user + cpuUsageEnd.system) / elapsedTime) * 100;

			// System uptime
			const systemUptimeSec = os.uptime();

			// System memory usage
			const totalMemMB = os.totalmem() / 1024 / 1024;
			const freeMemMB = os.freemem() / 1024 / 1024;
			const usedMemMB = totalMemMB - freeMemMB;
			const memUsagePercent = (usedMemMB / totalMemMB) * 100;

			// System CPU usage (average across cores)
			// We'll calculate usage by sampling CPU times over 100ms

			function getCpuTimes() {
				const cpus = os.cpus();
				return cpus.map(cpu => {
					const times = cpu.times;
					const total = Object.values(times).reduce((acc, tv) => acc + tv, 0);
					return { idle: times.idle, total };
				});
			}

			const cpuTimes1 = getCpuTimes();
			await new Promise(resolve => setTimeout(resolve, 100));
			const cpuTimes2 = getCpuTimes();

			let idleDiff = 0;
			let totalDiff = 0;
			for (let i = 0; i < cpuTimes1.length; i++) {
				idleDiff += cpuTimes2[i].idle - cpuTimes1[i].idle;
				totalDiff += cpuTimes2[i].total - cpuTimes1[i].total;
			}

			const systemCpuPercent = 100 - (idleDiff / totalDiff) * 100;

			// System disk space remaining
			// Node.js does not have native disk space info; using 'df' command on *nix systems
			let diskFreeMB = 0;
			try {
				// This returns something like:
				// Filesystem  1K-blocks    Used Available Use% Mounted on
				// /dev/sda1  953869076 153549360 739362248  18% /
				const dfOutput = execSync('df -k --output=avail /').toString();
				// Split lines, get the second line, which is available blocks in 1K blocks
				const lines = dfOutput.trim().split('\n');
				const availKBlocks = parseInt(lines[1], 10);
				diskFreeMB = availKBlocks / 1024;
			} catch {
				// fallback if df is unavailable
				diskFreeMB = -1;
			}

			const systemContent =
				`# System Status\n` +
				`🖥️ ⁞ System Uptime: \`${formatUptime(systemUptimeSec)}\`\n` +
				`🤖 ⁞ Bot Uptime: \`${formatUptime(botUptimeSec)}\`\n\n` +

				`🤖 Bot Memory Usage: \`${botMemMB.toFixed(2)} MB\`\n` +
				`🤖 Bot CPU Usage: \`${botCpuPercent.toFixed(2)}%\`\n\n` +

				`🖥️ System CPU Usage: \`${systemCpuPercent.toFixed(2)}%\`\n` +
				`🖥️ System Memory Usage: \`${usedMemMB.toFixed(2)} MB / ${totalMemMB.toFixed(2)} MB (${memUsagePercent.toFixed(2)}%)\`\n` +
				(diskFreeMB >= 0
					? `💽 Disk Space Remaining: \`${diskFreeMB.toFixed(2)} MB\`\n`
					: `💽 Disk Space Remaining: \`Unavailable\`\n`
				) +
				`🧠 Platform: \`${os.platform()} (${os.arch()})\`\n`;

			// Use Container/TextDisplay and Components V2 directly (targeting discord.js v14+)
			const systemText = new TextDisplayBuilder().setContent(systemContent);
			const container = new ContainerBuilder().addTextDisplayComponents(systemText);
			await interaction.editReply({
				flags: MessageFlags.IsComponentsV2,
				components: [container],
			});
		} catch (error) {
			console.error('❌ Failed to execute /status command:', error);

			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: '❌ Something went wrong while executing the command.',
					ephemeral: true,
				});
			}
		}
	},


  // Rate limit: 2 seconds 
  rateLimit: 2000,
};
