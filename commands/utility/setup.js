const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { updateGuildSetting } = require('../../data/database.js');

// Settings are now grouped into categories. Each category will be a subcommand.
const settingsGroups = {
    general: {
        description: 'Configure general bot settings.',
        settings: {
            cmd_prefix: { type: 'string', description: 'Command prefix (for legacy commands)' },
            bot_enabled: { type: 'boolean', description: 'Enable or disable the bot entirely' },
            enable_automod: { type: 'boolean', description: 'Enable or disable the AutoMod features' },
            enable_openAI: { type: 'boolean', description: 'Enable or disable OpenAI features' },
        }
    },
    roles: {
        description: 'Configure role-based permissions and settings.',
        settings: {
            roles_admin: { type: 'role_array', description: 'Admin roles' },
            roles_mod: { type: 'role_array', description: 'Moderator roles' },
            roles_trust: { type: 'role_array', description: 'Trusted roles' },
            roles_untrusted: { type: 'role_array', description: 'Untrusted roles' },
        }
    },
    moderation: {
        description: 'Configure moderation, mute, kick, and ban settings.',
        settings: {
            mute_roleID: { type: 'role', description: 'The role assigned to muted users' },
            mute_rolesRemoved: { type: 'role_array', description: 'Roles to be removed upon mute' },
            mute_immuneUserIDs: { type: 'user_array', description: 'Users immune to mutes' },
            kick_immuneRoles: { type: 'role_array', description: 'Roles immune to kicks' },
            kick_immuneUserID: { type: 'user_array', description: 'Users immune to kicks' },
            ban_immuneRoles: { type: 'role_array', description: 'Roles immune to bans' },
            ban_immuneUserID: { type: 'user_array', description: 'Users immune to bans' },
        }
    },
    channels: {
        description: 'Configure logging and feature channels.',
        settings: {
            ch_actionLog: { type: 'channel', description: 'Log channel for general actions' },
            ch_kickbanLog: { type: 'channel', description: 'Log channel for kicks and bans' },
            ch_auditLog: { type: 'channel', description: 'Log channel for server audits' },
            ch_airlockJoin: { type: 'channel', description: 'Log channel for member joins' },
            ch_airlockLeave: { type: 'channel', description: 'Log channel for member leaves' },
            ch_deletedMessages: { type: 'channel', description: 'Log for deleted messages' },
            ch_editedMessages: { type: 'channel', description: 'Log for edited messages' },
            ch_automod_AI: { type: 'channel', description: 'Log for AI AutoMod flags' },
            ch_voiceLog: { type: 'channel', description: 'Log for voice channel activity' },
            ch_inviteLog: { type: 'channel', description: 'Log channel for invite creation and usage' },
            ch_permanentInvites: { type: 'channel', description: 'Channel for permanent server invites' },
            ch_memberJoin: { type: 'channel', description: 'Channel for member join notifications with invite tracking' },
        }
    },
    automod_ignore: {
        description: 'Configure channels and categories for AutoMod to ignore.',
        settings: {
            ch_categoryIgnoreAutomod: { type: 'channel_array', channel_types: [ChannelType.GuildCategory], description: 'Categories to ignore for AutoMod' },
            ch_channelIgnoreAutomod: { type: 'channel_array', channel_types: [ChannelType.GuildText], description: 'Channels to ignore for AutoMod' },
        }
    }
};

// A simple regex to validate that the input contains only characters expected in mentions, IDs, and delimiters.
const safeInputRegex = /^[\d\s,<@&#>!]+$/;

// --- Command Builder ---
const builder = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure server settings for the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false);

// Dynamically build subcommands from the settingsGroups object
for (const groupName in settingsGroups) {
    const group = settingsGroups[groupName];
    builder.addSubcommand(subcommand => {
        subcommand.setName(groupName)
            .setDescription(group.description)
            .addStringOption(option => {
                option.setName('setting')
                    .setDescription('The setting you want to configure.')
                    .setRequired(true);
                // Add choices for each setting in the group
                for (const settingKey in group.settings) {
                    option.addChoices({ name: settingKey, value: settingKey });
                }
                return option;
            })
            .addStringOption(option =>
                option.setName('value')
                    .setDescription('The new value. For lists, separate with spaces. Use "clear" to empty a list.')
                    .setRequired(true));
        return subcommand;
    });
}


module.exports = {
    data: builder,
    async execute(interaction) {
        const groupName = interaction.options.getSubcommand();
        const settingKey = interaction.options.getString('setting');
        const rawValue = interaction.options.getString('value');

        const group = settingsGroups[groupName];
        const settingConfig = group.settings[settingKey];

        // --- Input Validation ---
        if (!safeInputRegex.test(rawValue)) {
            return interaction.reply({
                content: 'Error: The value contains invalid characters. Please only use mentions, IDs, spaces, and commas.',
                ephemeral: true
            });
        }
        
        let dbValue;
        let displayValue = rawValue;

        try {
            // --- Input Parsing ---
            switch (settingConfig.type) {
                case 'string':
                    if (rawValue.length > 100) {
                        return interaction.reply({ content: 'Error: Text input is too long (max 100 characters).', ephemeral: true });
                    }
                    dbValue = rawValue;
                    break;

                case 'boolean':
                    const trueValues = ['true', 'on', 'yes', '1', 'enable'];
                    const falseValues = ['false', 'off', 'no', '0', 'disable'];
                    const lowerValue = rawValue.toLowerCase();
                    if (trueValues.includes(lowerValue)) dbValue = true;
                    else if (falseValues.includes(lowerValue)) dbValue = false;
                    else return interaction.reply({ content: `Invalid boolean value. Use one of: \`${trueValues.join(', ')}\` or \`${falseValues.join(', ')}\`.`, ephemeral: true });
                    displayValue = dbValue.toString();
                    break;

                case 'role':
                case 'channel':
                case 'user':
                    const singleId = rawValue.match(/\d{17,20}/);
                    if (!singleId) return interaction.reply({ content: `Invalid value. Please provide a single, valid ${settingConfig.type} mention or ID.`, ephemeral: true });
                    dbValue = singleId[0];
                    if (settingConfig.type === 'role') displayValue = `<@&${dbValue}>`;
                    if (settingConfig.type === 'channel') displayValue = `<#${dbValue}>`;
                    if (settingConfig.type === 'user') displayValue = `<@${dbValue}>`;
                    break;

                case 'role_array':
                case 'channel_array':
                case 'user_array':
                    const ids = rawValue.toLowerCase() === 'clear' ? [] : rawValue.match(/\d{17,20}/g) || [];
                    dbValue = JSON.stringify(ids);
                    displayValue = ids.length > 0 ? ids.map(id => {
                        if (settingConfig.type === 'role_array') return `<@&${id}>`;
                        if (settingConfig.type === 'channel_array') return `<#${id}>`;
                        return `<@${id}>`;
                    }).join(', ') : '_(Empty)_';
                    break;
                
                default:
                     return interaction.reply({ content: 'An unexpected error occurred: Unknown setting type.', ephemeral: true });
            }
        } catch (error) {
            console.error('[SETUP COMMAND] Error parsing input:', error);
            return interaction.reply({ content: 'There was an error parsing your input. Please check the format.', ephemeral: true });
        }

        // --- Database Update ---
        try {
            await updateGuildSetting(interaction.guild.id, settingKey, dbValue);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Setting Updated')
                .setDescription(`Successfully updated the server configuration for the \`${groupName}\` category.`)
                .addFields(
                    { name: 'Setting', value: `\`${settingKey}\``, inline: true },
                    { name: 'New Value', value: displayValue, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `Updated by ${interaction.user.tag}`});

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[SETUP COMMAND] Error updating database:', error);
            await interaction.reply({ content: 'An error occurred while saving the setting to the database.', ephemeral: true });
        }
    },
};
