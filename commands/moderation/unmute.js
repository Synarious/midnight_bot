const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../data/database.js');
const { getGuildSettings, getActiveMute, deactivateMute } = db;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a user')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('User to unmute')
        .setRequired(true)
    )
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason for unmuting')
        .setMaxLength(512)
    ),
  
  async execute(interaction) {
    const { guild, member } = interaction;
    const userToUnmute = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Get guild settings
    const settings = await getGuildSettings(guild.id);
    if (!settings) {
      return interaction.reply({ content: 'Guild settings not found. Please run the setup command.', ephemeral: true });
    }

    // Bot permission check
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'I do not have permission to manage roles.', ephemeral: true });
    }

    // Permission checks
    const hasAdminPerm = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasPermission = hasAdminPerm || await db.hasPermissionLevel(guild.id, member.id, 'mod', member.roles.cache);

    if (!hasPermission) {
      return interaction.reply({ content: 'You do not have permission to unmute users. Requires mod level or higher.', ephemeral: true });
    }

    // Get active mute from database
    const muteRecord = await getActiveMute(guild.id, userToUnmute.id);
    if (!muteRecord) {
      return interaction.reply({ content: 'This user is not muted.', ephemeral: true });
    }

    // Validate mute role exists and is configured
    if (!settings.mute_roleid) {
      return interaction.reply({ content: 'No mute role is configured for this server.', ephemeral: true });
    }

    const muteRole = await guild.roles.fetch(settings.mute_roleid).catch(() => null);
    if (!muteRole) {
      return interaction.reply({ content: 'The configured mute role no longer exists.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Get the member
      const userToUnmuteMember = await guild.members.fetch(userToUnmute.id).catch(() => null);
      if (!userToUnmuteMember) {
        return interaction.editReply('User is not in the server.');
      }

      // Verify user actually has the mute role
      if (!userToUnmuteMember.roles.cache.has(settings.mute_roleid)) {
        // User doesn't have mute role but has active record - clean up database
        await deactivateMute(muteRecord.mute_id);
        return interaction.editReply('User is not currently muted (database record cleaned up).');
      }

      // Restore the user's roles
      const previousRoles = JSON.parse(muteRecord.roles);
      const rolesToRestore = previousRoles.filter(roleId => guild.roles.cache.has(roleId));
      
      await userToUnmuteMember.roles.set(rolesToRestore);
      
      // Deactivate the mute in database
      await deactivateMute(muteRecord.mute_id);

      // Send DM
      try {
        await userToUnmuteMember.send(`You have been unmuted in ${guild.name}. Reason: ${reason}`);
      } catch (error) {
        console.error(`Failed to send DM to ${userToUnmuteMember.user.tag}`);
      }

      // Log action in the action log channel
  const logChannelId = settings.ch_actionlog ?? settings.ch_actionLog;
      if (!logChannelId) {
        console.error(`[ERROR] No action log configured for guild ${guild.id}. Cannot log unmute for ${userToUnmute.id}`);
      } else {
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
          console.error(`[ERROR] Configured action log channel ${logChannelId} for guild ${guild.id} not found or inaccessible.`);
        } else {
          const embed = new EmbedBuilder()
            .setTitle('User Unmuted')
            .addFields(
              { name: 'Unmuted User', value: `${userToUnmuteMember.user.tag} (${userToUnmuteMember.id})`, inline: false },
              { name: 'Moderator', value: `${member.user.tag} (${member.id})`, inline: false },
              { name: 'Reason', value: reason, inline: false }
            )
            .setColor('#00FF00')
            .setTimestamp();
          
          await logChannel.send({ embeds: [embed] }).catch(err => {
            console.error(`[ERROR] Failed to send unmute log to channel ${logChannelId} for guild ${guild.id}:`, err);
          });
        }
      }

      console.log(`Unmuted ${userToUnmuteMember.user.tag} in ${guild.name}. Reason: ${reason}`);
      return interaction.editReply(`Successfully unmuted ${userToUnmuteMember.user.tag} for: ${reason}`);

    } catch (error) {
      console.error(`Failed to unmute ${userToUnmute.tag}:`, error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('An unexpected error occurred while unmuting. I may lack permissions.');
      } else {
        await interaction.reply({ content: 'An unexpected error occurred while unmuting. I may lack permissions.', ephemeral: true });
      }
    }
  }
};
