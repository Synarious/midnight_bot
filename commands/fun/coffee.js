const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coffee')
        .setDescription('Get a random coffee image'),

    async execute(interaction) {
        try {
            const response = await fetch('https://coffee.alexflipnote.dev/random.json');
            const data = await response.json();
            
            const embed = new MessageEmbed()
                .setColor('#6F4E37')
                .setTitle('☕ Coffee Time!')
                .setImage(data.file)
                .setFooter({ text: 'Powered by coffee.alexflipnote.dev' });
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching coffee:', error);
            await interaction.reply({ 
                content: 'Sorry, I couldn\'t get your coffee right now. Try again later!',
                ephemeral: true 
            });
        }
    },

    // Rate limit: 5 seconds (API call)
    rateLimit: 5000,
};