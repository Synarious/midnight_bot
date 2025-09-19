const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const { pool } = require('../../data/database.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ccban')
    .setDescription('Ban a user and do complete clean of their messages.')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('User')
        .setRequired(true)
    )
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason')
        .setMaxLength(512)
    ),

  async execute(interaction) {
    const { guild, member, channel } = interaction;
    const userToBan = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Fetch guild settings from DB
    const result = await pool.query('SELECT roles_admin, roles_mod, ch_actionLog FROM guild_settings WHERE guild_id = $1', [guild.id]);
    if (!result.rows[0]) {
      return interaction.reply({ content: 'Guild settings not found in the database.', ephemeral: true });
    }

    const settings = result.rows[0];
    const roles_admin = Array.isArray(settings.roles_admin) ? settings.roles_admin : 
                       (settings.roles_admin ? JSON.parse(settings.roles_admin) : []);
    const roles_mod = Array.isArray(settings.roles_mod) ? settings.roles_mod :
                     (settings.roles_mod ? JSON.parse(settings.roles_mod) : []);
    const ch_actionLog = settings.ch_actionlog || settings.ch_actionlog;

    // Check if user has required permissions
    const hasPermission = member.roles.cache.some(role => 
      roles_admin.includes(role.id) || roles_mod.includes(role.id)
    ) || member.permissions.has('ADMINISTRATOR');

    if (!hasPermission) {
      return interaction.reply({ 
        content: 'You do not have permission to use this command.', 
        ephemeral: true 
      });
    }

    // Check if the user can be banned
    const botMember = guild.members.me;
    if (!botMember?.permissions.has('BanMembers')) {
      return interaction.reply({ 
        content: 'I do not have permission to ban members.', 
        ephemeral: true 
      });
    }

    try {
      // Ban the user and delete their messages from the last 7 days
      await guild.members.ban(userToBan, { 
        reason: reason,
        days: 7 // Delete messages from the last 7 days
      });

      // Create embed for success message
      const banEmbed = new MessageEmbed()
        .setColor('#FF0000')
        .setTitle('User Banned')
        .addFields(
          { name: 'User', value: `${userToBan.tag} (${userToBan.id})` },
          { name: 'Reason', value: reason },
          { name: 'Moderator', value: `${interaction.user.tag}` }
        )
        .setTimestamp();

      // Send success message
      await interaction.reply({ embeds: [banEmbed] });

      // Log the action if a log channel is set
      if (ch_actionLog) {
        const logChannel = guild.channels.cache.get(ch_actionLog);
        if (logChannel) {
          await logChannel.send({ embeds: [banEmbed] });
        }
      }
    } catch (error) {
      console.error('Error in ccban command:', error);
      await interaction.reply({ 
        content: 'An error occurred while trying to ban the user.', 
        ephemeral: true 
      });
    }
  }
};
