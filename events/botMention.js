const { Events } = require('discord.js');

// Fun emoji reactions when bot is mentioned
const EMOJI_REACTIONS = [
	'👋', '😊', '🎉', '💙', '✨', '😄', '🤗', '😎', 
	'🥳', '💫', '🌟', '❤️', '😁', '👀', '🎈', '🎊',
	'🔥', '⭐', '💜', '🌈', '🦋', '🌸', '☀️', '🌙'
];

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		// Ignore bot messages
		if (message.author.bot) return;
		
		// Check if bot is mentioned
		if (message.mentions.has(message.client.user)) {
			try {
				// Pick a random emoji
				const randomEmoji = EMOJI_REACTIONS[Math.floor(Math.random() * EMOJI_REACTIONS.length)];
				
				// React to the message
				await message.react(randomEmoji);
			} catch (error) {
				// Silently fail if reaction fails (missing permissions, etc.)
				console.log('Could not react to message:', error.message);
			}
		}
	}
};
