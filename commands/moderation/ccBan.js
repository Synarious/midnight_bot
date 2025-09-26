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
  const ch_actionLog = settings.ch_actionLog;

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

    // Bot permission check
    const botMember = guild.members.me;
    if (!botMember?.permissions.has('BanMembers')) {
      return interaction.reply({ 
        content: 'I do not have permission to ban members.', 
        ephemeral: true 
      });
    }

    // Bannable check
    const memberToBan = await guild.members.fetch(userToBan.id).catch(() => null);
    if (memberToBan && !memberToBan.bannable) {
      return interaction.reply({ content: 'I cannot ban that user. They may have a higher role than me or I lack ban permissions.', ephemeral: true });
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

      // Log the action using DB-configured channel only
      if (!ch_actionLog) {
        console.error(`[ERROR] No action log configured for guild ${guild.id}. Cannot log ccban for ${userToBan.id}`);
      } else {
        const logChannel = await guild.channels.fetch(ch_actionLog).catch(() => null);
        if (!logChannel) {
          console.error(`[ERROR] Configured action log channel ${ch_actionLog} for guild ${guild.id} not found or inaccessible.`);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp?.({ content: 'Ban recorded but failed to send to action log channel (configured channel missing).', ephemeral: true }).catch(() => {});
            } else {
              await interaction.reply?.({ content: 'Ban recorded but failed to send to action log channel (configured channel missing).', ephemeral: true }).catch(() => {});
            }
          } catch (_) {}
        } else {
          await logChannel.send({ embeds: [banEmbed] }).catch(err => {
            console.error(`[ERROR] Failed to send ccban log to channel ${ch_actionLog} for guild ${guild.id}:`, err);
          });
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
