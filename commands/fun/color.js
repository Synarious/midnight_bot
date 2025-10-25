const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const AlexFlipnote = require('alexflipnote.js');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('color')
        .setDescription('Get information about a color')
        .addStringOption(option =>
            option.setName('hex')
                .setDescription('The hex color code (e.g. #FF0000)')
                .setRequired(true)),

    async execute(interaction) {
        let hex = interaction.options.getString('hex');
        
        // Remove # if present and validate hex format
        hex = hex.replace('#', '');
            if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return interaction.reply({ 
                content: 'Please provide a valid hex color code (e.g. #FF0000)',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const apiKey = process.env.ALEXFLIPNOTE_API_KEY;
            const alex = new AlexFlipnote({ key: apiKey });
            const data = await alex.color(hex);
            const embed = new EmbedBuilder()
                .setColor(`#${hex}`)
                .setTitle(`Color Information for #${hex}`)
                .addFields(
                    { name: 'RGB', value: data.rgb, inline: true },
                    { name: 'Name', value: data.name, inline: true },
                    { name: 'Brightness', value: `${data.brightness}%`, inline: true }
                )
                .setImage(data.image)
                .setFooter({ text: 'Powered by AlexFlipnote' });
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching color info:', error);
             await interaction.reply({ 
                 content: 'Sorry, I couldn\'t get the color information right now. Try again later!'
             });
        }
    },

    // Rate limit: 2 seconds (API call)
    rateLimit: 2000,
};