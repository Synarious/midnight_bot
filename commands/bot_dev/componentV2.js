const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('componentv2')
		.setDescription('Sends a custom component-based UI.'),

	async execute(interaction) {
		const userId = interaction.user.id;
		const timestamp = Math.floor(Date.now() / 1000); // Discord timestamp

		// Create the styled embed 
		const embed = new EmbedBuilder()
			.setColor(0x6379d3) // 6513507 in hex
			.setTitle('🛠️ Server Ping')
			.setDescription([
				'> - Reply',
				'> - Status',
				'> - Stuff',
				'> - Stuff',
				'> - Stuff',
				`-# Time: <t:${timestamp}:R>\n-# UserID: ${userId}`,
			].join('\n'));

		// Create the link button (no customId allowed for link buttons)
		const buttonRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setLabel('API')
				.setStyle(ButtonStyle.Link)
				.setURL('https://discordstatus.com/')
		);

		// Respond to interaction with embed + button
		await interaction.reply({
			embeds: [embed],
			components: [buttonRow]
		});
	},
};
