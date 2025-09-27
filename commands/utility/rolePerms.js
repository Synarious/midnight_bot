const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { PermissionsBitField } = require('discord.js');
const db = require('../../data/database.js'); 

module.exports = {
  name: 'roleperms',
  description: 'Set roles for the 5-tier permission system',
  usage: 'roleperms <permission_type> <role_mentions_or_ids>',
  permissions: ['Administrator'],
  
  data: new SlashCommandBuilder()
    .setName('roleperms')
    .setDescription('Set roles for the 5-tier permission system')
    .addStringOption(option =>
      option.setName('permission')
        .setDescription('Specify permission type')
        .setRequired(true)
        .addChoices(
          { name: 'Super Admin', value: 'super_admin' },
          { name: 'Admin', value: 'admin' },
          { name: 'Mod', value: 'mod' },
          { name: 'Jr Mod', value: 'jr_mod' },
          { name: 'Helper', value: 'helper' }
        )
    )
    .addStringOption(option =>
      option.setName('roles')
        .setDescription('Space or comma-separated role mentions/IDs. Use "clear" to remove all.')
        .setRequired(false)
    ),

  async execute(interaction) {
    const { guild, member } = interaction;
    
    // Parse arguments for both slash and legacy commands
    let permissionType, roleInput;
    
    if (interaction.options?.getString) {
      // Slash command
      permissionType = interaction.options.getString('permission');
      roleInput = interaction.options.getString('roles');
    } else {
      // Legacy command
      const args = interaction.commandArgs || [];
      if (args.length === 0) {
        return this.showHelp(interaction);
      }
      
      permissionType = args[0]?.toLowerCase();
      roleInput = args.slice(1).join(' ');
      
      // Map legacy names to new system
      const permissionMap = {
        'super-admin': 'super_admin',
        'superadmin': 'super_admin',
        'super_admin': 'super_admin',
        'admin': 'admin',
        'mod': 'mod',
        'jr-mod': 'jr_mod',
        'jrmod': 'jr_mod',
        'jr_mod': 'jr_mod',
        'helper': 'helper'
      };
      
      permissionType = permissionMap[permissionType];
      if (!permissionType) {
        return this.showHelp(interaction);
      }
    }

    // Permission check - only Administrator or Super Admin can use this
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const settings = await db.getGuildSettings(guild.id);
      if (settings) {
        const superAdminRoles = JSON.parse(settings.roles_super_admin || '[]');
        const hasPermission = member.roles.cache.some(role => superAdminRoles.includes(role.id));
        
        if (!hasPermission) {
          return interaction.reply({ 
            content: '❌ You need Administrator permissions or Super Admin role to use this command.', 
            ephemeral: true 
          });
        }
      } else {
        return interaction.reply({ 
          content: '❌ You need Administrator permissions to use this command.', 
          ephemeral: true 
        });
      }
    }

    // Parse role input
    let roleIDs = [];
    if (roleInput && roleInput.toLowerCase() !== 'clear') {
      // Extract role IDs from mentions and direct IDs
      const roleMatches = roleInput.match(/<@&(\d+)>|\d{17,20}/g) || [];
      roleIDs = roleMatches.map(match => {
        const mentionMatch = match.match(/<@&(\d+)>/);
        return mentionMatch ? mentionMatch[1] : match;
      }).filter(id => /^\d{17,20}$/.test(id));
      
      // Validate that roles exist in the guild
      const invalidRoles = [];
      for (const roleId of roleIDs) {
        const role = guild.roles.cache.get(roleId);
        if (!role) {
          invalidRoles.push(roleId);
        }
      }
      
      if (invalidRoles.length > 0) {
        return interaction.reply({ 
          content: `❌ Invalid or non-existent roles: ${invalidRoles.join(', ')}`, 
          ephemeral: true 
        });
      }
    }

    try {
      // Update the guild settings
      await db.setRolePermissions(guild.id, permissionType, roleIDs);

      // Create response embed
      const embed = new EmbedBuilder()
        .setTitle('🔧 Role Permissions Updated')
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: `Updated by ${interaction.user?.tag || interaction.member?.displayName || 'Unknown'}` });

      const permissionNames = {
        'super_admin': 'Super Admin',
        'admin': 'Admin',
        'mod': 'Mod',
        'jr_mod': 'Jr Mod',
        'helper': 'Helper'
      };

      const permissionName = permissionNames[permissionType] || permissionType;

      if (roleIDs.length > 0) {
        const roleList = roleIDs.map(id => `<@&${id}>`).join('\n');
        embed.addFields(
          { name: 'Permission Level', value: permissionName, inline: true },
          { name: 'Action', value: 'Roles Set', inline: true },
          { name: 'Roles', value: roleList, inline: false }
        );
      } else {
        embed.addFields(
          { name: 'Permission Level', value: permissionName, inline: true },
          { name: 'Action', value: 'Roles Cleared', inline: true }
        );
      }

      // Handle reply for both slash and legacy commands
      if (interaction.reply && !interaction.replied) {
        await interaction.reply({ embeds: [embed] });
      } else if (interaction.editReply) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.channel?.send({ embeds: [embed] });
      }

    } catch (error) {
      console.error(`[❌ COMMAND FAILED] roleperms:`, error);
      const errorMsg = '❌ An error occurred while updating the role permissions.';
      
      if (interaction.reply && !interaction.replied) {
        await interaction.reply({ content: errorMsg, ephemeral: true });
      } else {
        await interaction.channel?.send(errorMsg);
      }
    }
  },

  async showHelp(interaction) {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🔧 Role Permissions Command Help')
      .setColor('#0099FF')
      .setDescription('Configure the 5-tier permission system for your server')
      .addFields(
        {
          name: '📝 Usage',
          value: '`!roleperms <permission_type> <roles>`\n`/roleperms permission:<type> roles:<roles>`',
          inline: false
        },
        {
          name: '🏷️ Permission Types',
          value: [
            '• `super-admin` - Highest level access',
            '• `admin` - Administrative access',
            '• `mod` - Moderation access',
            '• `jr-mod` - Junior moderation access',
            '• `helper` - Helper level access'
          ].join('\n'),
          inline: false
        },
        {
          name: '💡 Examples',
          value: [
            '`!roleperms admin @AdminRole @StaffRole`',
            '`!roleperms mod 123456789012345678`',
            '`!roleperms helper clear` - Remove all helper roles'
          ].join('\n'),
          inline: false
        },
        {
          name: '⚠️ Notes',
          value: 'Only users with Administrator permission or Super Admin roles can use this command.',
          inline: false
        }
      )
      .setTimestamp();

    if (interaction.reply && !interaction.replied) {
      await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    } else {
      await interaction.channel?.send({ embeds: [helpEmbed] });
    }
  }
};