const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require('discord.js');

// ==================== CONFIGURATION ====================
// Easy to modify - add or remove onboarding categories and roles here

// Gate role that is removed when user completes captcha
const GATE_ROLE_ID = '1425702277410455654';

const ONBOARDING_CATEGORIES = [
  {
    name: 'Pronouns',
    description: 'Select your pronouns (Req.)',
    emoji: '🏳️‍🌈',
    selectionType: 'REQUIRED_ONE', // REQUIRED_ONE, ONLY_ONE, MULTIPLE, NONE_OR_ONE, NONE_OR_MULTIPLE
    roles: [
      { id: '1346026355749425162', name: 'He/Him', emoji: '👨', key: 'hehim' },
      { id: '1346026308253122591', name: 'She/Her', emoji: '👩', key: 'sheher' },
      { id: '1346026355112022036', name: 'They/Them', emoji: '🧑', key: 'theythem' }
    ]
  },
  {
    name: 'Region',
    description: 'Select your region (Req.)',
    emoji: '🌍',
    selectionType: 'REQUIRED_ONE',
    roles: [
      { id: '1346009391907737631', name: 'North America', emoji: '🌎', key: 'na' },
      { id: '1346008779929550891', name: 'South America', emoji: '🌎', key: 'sa' },
      { id: '1346007791344680980', name: 'Europe', emoji: '🌍', key: 'eu' },
      { id: '1346008937371275317', name: 'Asia', emoji: '🌏', key: 'asia' },
      { id: '1346008958178955366', name: 'Australia', emoji: '🦘', key: 'oceania' },
      { id: '1346009038306934836', name: 'Africa', emoji: '🌍', key: 'africa' }
    ]
  },
  {
    name: 'Age',
    description: 'Select your age range (Req.)',
    emoji: '🎂',
    selectionType: 'REQUIRED_ONE',
    roles: [
      { id: '1364164214272561203', name: '18-25', emoji: '🔞', key: 'age_18_25' },
      { id: '1346238384003219577', name: '25+', emoji: '🔞', key: 'age_25_plus' }
    ]
  },
  {
    name: 'Gaming',
    description: 'Do you enjoy video gaming (Req.)',
    emoji: '🎮',
    selectionType: 'REQUIRED_ONE',
    roles: [
      { id: '1363056342088290314', name: 'Gamer', emoji: '🎮', key: 'gamer' },
      { id: '1363056678299504710', name: 'Non-Gamer', emoji: '🌱', key: 'grass' }
    ]
  }
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Get category by name
 */
function getCategoryByName(categoryName) {
  return ONBOARDING_CATEGORIES.find(cat => cat.name === categoryName);
}

/**
 * Get all role IDs from a category
 */
function getCategoryRoleIds(category) {
  return category.roles.map(role => role.id);
}

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
      .setCustomId(`onboarding_select:${safeCategoryId}`)
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
  name: 'captcha-onboarding',
  description: 'Post the onboarding captcha embed with selection menus.',
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
        'Select your roles from the menus below to help us get to know you better. Addtional roles can be selected later in #role-assign.',
        'When you\'re ready, hit **Finish & Join** to receive a one-time verification code (visible only to you).',
        '',
        'If something goes wrong or the captcha expires, you can click **Finish** again to get a fresh code.',
      ].join('\n'))
      .setColor(0x5865F2)
      .setFooter({ text: 'Captcha expires in 1 minutes.' });

    const finishButton = new ButtonBuilder()
      .setCustomId('onboarding_finish')
      .setLabel('Finish & Join')
      .setStyle(ButtonStyle.Success);

    const selectMenuRows = createOnboardingSelectMenus();
    const components = [
      ...selectMenuRows,
      new ActionRowBuilder().addComponents(finishButton),
    ];

    await message.channel.send({ embeds: [embed], components });
    
    // Generate detailed role report
    let report = '✅ **Onboarding captcha posted successfully!**\n\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    // Show gate role information
    const gateRole = message.guild.roles.cache.get(GATE_ROLE_ID);
    if (gateRole) {
      report += `**🚪 Gate Role:** ${gateRole.name} (ID: \`${GATE_ROLE_ID}\`)\n`;
      report += `This role will be removed when users complete the captcha.\n\n`;
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
  getCategoryByName,
  getCategoryRoleIds,


  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
