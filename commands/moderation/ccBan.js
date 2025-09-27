const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../data/database.js');

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
    const settings = await db.getGuildSettings(guild.id);
    if (!settings) {
      return interaction.reply({ content: 'Guild settings not found in the database.', ephemeral: true });
    }

    const ch_actionLog = settings.ch_actionlog ?? settings.ch_actionLog;

    // Check if user has required permissions
    const hasAdminPerm = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasPermission = hasAdminPerm || await db.hasPermissionLevel(guild.id, member.id, 'jr_mod', member.roles.cache);

    if (!hasPermission) {
      return interaction.reply({ 
        content: 'You do not have permission to use this command. Requires jr. mod level or higher.', 
        ephemeral: true 
      });
    }

    // Bot permission check
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
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
  const deleteMessageSeconds = 60 * 60 * 24 * 7; // 7 days in seconds (Discord max)
      await guild.members.ban(userToBan.id, { 
        reason,
        deleteMessageSeconds
      });

      // Create embed for success message
      const banEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
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
