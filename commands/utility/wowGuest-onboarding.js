const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const { GATE_ROLE_ID } = require('../../features/onboarding/wowguildGuest');


// ==================== COMMAND ====================

module.exports = {
  name: 'wowguest-onboarding',
  description: 'Post the WoW guest onboarding embed and button.',
  usage: '/wowguest-onboarding',
  async execute(message) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used inside a server.');
    }

    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need the Administrator permission to post the onboarding.');
    }

    const embed = new EmbedBuilder()
      .setTitle('Are you not a guild member? Finish joining below as a guest!')
      .setDescription([
        'When you\'re ready, hit **Finish & Join** to enter your character name.',
        'Your nickname will be set to your character name and you\'ll gain access to the server.',
        '',
        'Click **Finish & Join** to get started!',
      ].join('\n'))
      .setColor(0x5865F2);

    const finishButton = new ButtonBuilder()
      .setCustomId('wow_guest_finish')
      .setLabel('Finish & Join')
      .setStyle(ButtonStyle.Success);

    const components = [
      new ActionRowBuilder().addComponents(finishButton),
    ];

    await message.channel.send({ embeds: [embed], components });
    
    // Generate detailed role report
    let report = '✅ **WoW guest onboarding posted successfully!**\n\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    // Show gate role information
    const gateRole = message.guild.roles.cache.get(GATE_ROLE_ID);
    if (gateRole) {
      report += `**🚪 Gate Role:** ${gateRole.name} (ID: \`${GATE_ROLE_ID}\`)\n`;
      report += `This role is removed when the user completes onboarding.\n\n`;
    } else {
      report += `**🚪 Gate Role:** ⚠️ **[ROLE NOT FOUND]** (ID: \`${GATE_ROLE_ID}\`)\n\n`;
    }
    
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    report += '**Guest Onboarding Flow:**\n';
    report += '1. User clicks "Finish & Join"\n';
    report += '2. Modal appears asking for character name\n';
    report += '3. Nickname is set to character name\n';
    report += '4. Gate role is removed\n';
    report += '5. Welcome message is sent\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    await message.reply(report);
  },

  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
