const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  getOnboardingSettings
} = require('../../data/automodSettings');

// ==================== CONFIGURATION ====================
// Onboarding config is guild-specific and dashboard-managed.

// ==================== HELPER FUNCTIONS ====================

/**
 * Get category by name
 */
function getCategoryByName(categoryName) {
  return [];
}

/**
 * Get all role IDs from a category
 */
function getCategoryRoleIds(category) {
  return category.roles.map(role => role.id);
}

/**
 * Get role config by key within a category
 */
function getRoleByKey(category, key) {
  return category.roles.find(role => role.key === key);
}

/**
 * Get onboarding configuration from database for a guild
 */
async function getGuildOnboardingConfig(guildId) {
    try {
        const data = await getOnboardingSettings(guildId);
        
        if (!data || !data.settings) {
            return {
                gateRoleId: null,
                logChannelId: null,
                welcomeChannelId: null,
                categories: [],
                enabled: true
            };
        }

        return {
            gateRoleId: data.settings.gate_role_id,
            logChannelId: data.settings.log_channel_id,
            welcomeChannelId: data.settings.welcome_channel_id,
            categories: data.categories.map(cat => ({
                id: cat.id,
                name: cat.name,
                description: cat.description,
                emoji: cat.emoji,
                selectionType: cat.selection_type,
                roles: cat.roles.map(r => ({
                    id: r.role_id,
                    name: r.name,
                    emoji: r.emoji,
                    key: r.key
                }))
            })),
            enabled: data.settings.enabled
        };
    } catch (error) {
        console.error('[Captcha] Error fetching config from DB:', error);
        return {
            gateRoleId: null,
            logChannelId: null,
            welcomeChannelId: null,
            categories: [],
            enabled: true
        };
    }
}
function getCategoryRoleIds(category) {
  return category.roles.map(role => role.id);
}

function safeCategoryIdFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Create select menus for all onboarding categories
 */
function createOnboardingSelectMenus(categories) {
  const rows = [];

  for (const category of categories) {
    const options = category.roles.map(role => ({
      label: role.name,
      value: role.key,
      emoji: role.emoji || undefined,
    }));
    // Sanitize category name for use in custom IDs (no spaces or special chars)
    const safeCategoryId = safeCategoryIdFromName(category.name);

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

    const config = await getGuildOnboardingConfig(message.guild.id);
    const gateRoleId = config?.gateRoleId;
    const categories = Array.isArray(config?.categories) ? config.categories : [];

    if (categories.length === 0) {
        return message.reply('❌ No onboarding categories configured. Please configure them in the dashboard first.');
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

    const selectMenuRows = createOnboardingSelectMenus(categories);
    const components = [
      ...selectMenuRows,
      new ActionRowBuilder().addComponents(finishButton),
    ];

    await message.channel.send({ embeds: [embed], components });
    
    // Generate detailed role report
    let report = '✅ **Onboarding captcha posted successfully!**\n\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    // Show gate role information
    const gateRole = message.guild.roles.cache.get(gateRoleId);
    if (gateRole) {
      report += `**🚪 Gate Role:** ${gateRole.name} (ID: \`${gateRoleId}\`)\n`;
      report += `This role will be removed when users complete the captcha.\n\n`;
    } else {
      report += `**🚪 Gate Role:** ⚠️ **[ROLE NOT FOUND]** (ID: \`${gateRoleId}\`)\n\n`;
    }
    
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    for (const category of categories) {
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

  // Export default configuration (guild-specific config is DB-backed)
  getCategoryByName,
  getCategoryRoleIds,


  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
