const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

const positiveMessages = [
    "You're doing great!",
    "Keep going, you've got this!",
    "You make the world a better place ❤️",
    "Your potential is limitless!",
    "Stay positive, good things are coming!",
    "You're stronger than you know!",
    "Every day is a new opportunity!",
    "Your smile brightens someone's day!",
    "You're capable of amazing things!",
    "Believe in yourself, we do!",
    "You're making progress, keep going!",
    "Today is going to be awesome!",
    "You're valued and appreciated!",
    "Your efforts matter!",
    "Keep shining bright!"
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('positivity')
        .setDescription('Get a random positive message to brighten your day'),

    async execute(interaction) {
        const randomMessage = positiveMessages[Math.floor(Math.random() * positiveMessages.length)];
        
        const embed = new MessageEmbed()
            .setColor('#FFD700')
            .setTitle('✨ Daily Positivity ✨')
            .setDescription(randomMessage)
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    },

    // Rate limit: 3 seconds
    rateLimit: 3000,
};