const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embedtest')
    .setDescription('Demonstrates Discord Components v2 with rich media layout'),

  async execute(interaction) {
    try {
      // Create a single comprehensive embed with all content
      const componentEmbed = new EmbedBuilder()
        .setColor('#5865F2') // Discord Blurple
        .setTitle('🎨 Introducing New Components for Messages!')
        .setDescription(
          'We\'re bringing new components to messages that you can use in your apps. They allow you to have full control over the layout of your messages.\n\n' +
          '**Our previous components system, while functional, had limitations:**\n' +
          '• Content, attachments, embeds, and components had to follow fixed positioning rules\n' +
          '• Visual styling options were limited\n\n' +
          '**Our new component system addresses these challenges** with fully composable components that can be arranged and laid out in any order, allowing for a more flexible and visually appealing design.\n\n' +
          '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
          '**📸 Gallery Showcase**\n' +
          '🏖️ **Beach Paradise** • 🏔️ **Mountain Views** • 🌆 **City Lights**\n\n' +
          '*Check out the images below for a demonstration of flexible media layouts!*'
        )
        .setImage('https://picsum.photos/800/400?random=1') // Main banner image at top
        .addFields(
          {
            name: '\u200B',
            value: '**🖼️ Image 1: Beach Paradise**',
            inline: false
          },
          {
            name: '\u200B', 
            value: '[View Beach Scene](https://picsum.photos/600/400?random=4)',
            inline: true
          },
          {
            name: '\u200B',
            value: '[View Mountain Scene](https://picsum.photos/600/400?random=5)',
            inline: true
          },
          {
            name: '\u200B',
            value: '[View City Scene](https://picsum.photos/600/400?random=6)',
            inline: true
          },
          {
            name: '✨ Key Features',
            value: '• Flexible positioning\n• Dynamic sizing\n• Rich media support\n• Interactive elements',
            inline: true
          },
          {
            name: '🎯 Use Cases',
            value: '• Product showcases\n• Photo galleries\n• Event announcements\n• Rich notifications',
            inline: true
          },
          {
            name: '📚 Resources',
            value: '• [Overview](https://discord.com)\n• [Reference](https://discord.com)\n• [Guide](https://discord.com)',
            inline: true
          }
        )
        .setFooter({ 
          text: 'This message was composed using components v2 • Check out the documentation', 
          iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png'
        })
        .setTimestamp();

      // Create interactive buttons matching the announcement style
      const buttonRow1 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('make_selection')
            .setLabel('Make a selection')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('�'),
          new ButtonBuilder()
            .setCustomId('view_poll')
            .setLabel('View Poll Results')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setLabel('Documentation')
            .setStyle(ButtonStyle.Link)
            .setURL('https://discord.com/developers/docs/interactions/message-components')
            .setEmoji('📚')
        );

      const buttonRow2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('overview')
            .setLabel('Overview')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📝'),
          new ButtonBuilder()
            .setCustomId('reference')
            .setLabel('Reference')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📖'),
          new ButtonBuilder()
            .setCustomId('guide')
            .setLabel('Guide')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🧭')
        );

      // Send the message with single embed and components
      await interaction.reply({ 
        embeds: [componentEmbed],
        components: [buttonRow1, buttonRow2]
      });

    } catch (error) {
      console.error('❌ Error in embedtest command:', error);
      await interaction.reply({ 
        content: 'An error occurred while creating the component demo.',
        ephemeral: true 
      });
    }
  },
};
