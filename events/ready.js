const { Events } = require('discord.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
        
		// Checks if guild_id exists, if not create new row with one. 
		await client.botStorage.syncGuildSettings(client);
	},
};
