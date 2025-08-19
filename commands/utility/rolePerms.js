const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
// Import the entire exports object from your database file
const db = require('../../data/database.js'); 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleperms')
    .setDescription('Set roles for admin, mod, or trust')
    .addStringOption(option =>
      option.setName('permission')
        .setDescription('Specify permission type (admin, mod, trust)')
        .setRequired(true)
        .addChoices(
          { name: 'Admin', value: 'admin' },
          { name: 'Mod', value: 'mod' },
          { name: 'Trust', value: 'trust' }
        )
    )
    .addStringOption(option =>
      option.setName('roles')
        .setDescription('Comma-separated list of role IDs. Leave blank to clear.')
        .setRequired(false)
    ),

  async execute(interaction) {
    const { guild, member } = interaction;
    const permissionType = interaction.options.getString('permission');
    const roleInput = interaction.options.getString('roles');
    // Provide an empty array if input is null or an empty string
    let roleIDs = roleInput ? roleInput.split(',').map(role => role.trim()).filter(id => id) : [];

    // Fetch guild settings using the new async function
    const settings = await db.getGuildSettings(guild.id);
    if (!settings) {
      return interaction.reply({ content: 'Guild settings not found. Please run a setup command.', ephemeral: true });
    }
    
    // Check for 'Administrator' permission
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      // Parse role strings from DB into arrays before checking
      const adminRoles = JSON.parse(settings.roles_admin || '[]');
      const modRoles = JSON.parse(settings.roles_mod || '[]');

      const hasPermission = member.roles.cache.some(role => 
        adminRoles.includes(role.id) || modRoles.includes(role.id)
      );

      if (!hasPermission) {
        return interaction.reply({ content: 'You do not have permission to set role permissions.', ephemeral: true });
      }
    }

    // Validate role IDs if any were provided
    if (roleIDs.length > 0) {
        const invalidRoleIDs = roleIDs.filter(roleID => !/^\d+$/.test(roleID));
        if (invalidRoleIDs.length > 0) {
          return interaction.reply({ content: `Invalid role ID format: ${invalidRoleIDs.join(', ')}`, ephemeral: true });
        }
    }

    try {
      // Update the guild settings using the new async function
      await db.setRolePermissions(guild.id, permissionType, roleIDs);

      const typeCapitalized = permissionType.charAt(0).toUpperCase() + permissionType.slice(1);
      const responseMessage = roleIDs.length > 0
          ? `${typeCapitalized} roles have been updated successfully!`
          : `${typeCapitalized} roles have been cleared.`;
          
      return interaction.reply({ content: responseMessage, ephemeral: true });
    } catch (error) {
      console.error(`[❌ COMMAND FAILED] /roleperms:`, error);
      // Check for the specific error from our function
      if (error.message.startsWith('Invalid permission type')) {
          return interaction.reply({ content: 'An internal error occurred: Invalid permission type specified.', ephemeral: true });
      }
      return interaction.reply({ content: 'An error occurred while updating the roles.', ephemeral: true });
    }
  }
};