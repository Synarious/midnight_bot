const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require('discord.js');

const { ONBOARDING_CATEGORIES, GATE_ROLE_ID } = require('../../features/onboarding/wowGuild');


// ==================== HELPER FUNCTIONS ====================

/**
 * Create select menus for all onboarding categories
 */
function createOnboardingSelectMenus() {
  const rows = [];

    for (const category of ONBOARDING_CATEGORIES) {
    const options = category.roles.map(role => ({
      label: role.name,
      value: role.key,
      emoji: role.emoji || undefined,
    }));
    // Sanitize category name for use in custom IDs (no spaces or special chars)
    const safeCategoryId = category.name.toLowerCase().replace(/\W+/g, '_').replace(/^_+|_+$/g, '');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`wow_select:${safeCategoryId}`)
      .setPlaceholder(`Select your ${category.name.toLowerCase()}`)
      .setMinValues(category.selectionType === 'REQUIRED_ONE' ? 1 : 0)
      .setMaxValues(
        category.selectionType === 'MULTIPLE' || category.selectionType === 'NONE_OR_MULTIPLE' 
          ? category.roles.length 
          : 1
      )
      .addOptions(options);

    rows.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  return rows;
}

// ==================== COMMAND ====================

module.exports = {
  name: 'wow-onboarding',
  description: 'Post the WoW onboarding embed and verification button.',
  usage: '!captcha-onboarding',
  async execute(message) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used inside a server.');
    }

    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need the Administrator permission to post the onboarding captcha.');
    }

    const embed = new EmbedBuilder()
      .setTitle('Welcome to the Server!')
      .setDescription([
        'Select your roles from the menus below to help us get to know you better. Additional roles can be selected later in #role-assign.',
        'When you\'re ready, hit **Finish & Join** to open the WoW verification modal.',
        'Provide your North American realm and character name so the bot can confirm Dawnbound membership on Moon Guard.',
        '',
        'If verification fails or you need to retry, just click **Finish & Join** again.',
      ].join('\n'))
      .setColor(0x5865F2)
      .setFooter({ text: 'Verification is handled via Blizzard API calls; no captcha is required.' });

    const finishButton = new ButtonBuilder()
      .setCustomId('wow_finish')
      .setLabel('Finish & Join')
      .setStyle(ButtonStyle.Success);

    const selectMenuRows = createOnboardingSelectMenus();
    const components = [
      ...selectMenuRows,
      new ActionRowBuilder().addComponents(finishButton),
    ];

    await message.channel.send({ embeds: [embed], components });
    
    // Generate detailed role report
  let report = '✅ **WoW onboarding posted successfully!**\n\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    // Show gate role information
    const gateRole = message.guild.roles.cache.get(GATE_ROLE_ID);
    if (gateRole) {
      report += `**🚪 Gate Role:** ${gateRole.name} (ID: \`${GATE_ROLE_ID}\`)\n`;
      report += `This role is removed when Dawnbound membership is verified via the WoW modal.\n\n`;
    } else {
      report += `**🚪 Gate Role:** ⚠️ **[ROLE NOT FOUND]** (ID: \`${GATE_ROLE_ID}\`)\n\n`;
    }
    
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    for (const category of ONBOARDING_CATEGORIES) {
      report += `**${category.emoji} ${category.name}** (${category.selectionType})\n`;
      
      for (const roleConfig of category.roles) {
        const role = message.guild.roles.cache.get(roleConfig.id);
        
        if (!role) {
          report += `  ⚠️ **${roleConfig.name}** - ID: \`${roleConfig.id}\` - **[ROLE NOT FOUND]**\n`;
          continue;
        }

        report += `  • **${roleConfig.name}** - ID: \`${roleConfig.id}\` - Key: \`${roleConfig.key}\`\n`;
      }
      report += '\n';
    }

    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    await message.reply(report);
  },

  // Export configuration for use by other modules
  ONBOARDING_CATEGORIES,
  GATE_ROLE_ID,


  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
