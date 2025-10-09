const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../data/database.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a user from the server, even if they have left.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to ban (can be an ID)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('The reason for the ban')
        .setMaxLength(512)
    ),

  async execute(interaction) {
    const { guild, member } = interaction;
    const userToBan = interaction.options.getUser('user');
    const auditReason = interaction.options.getString('reason') || 'No reason provided.';
    const displayReason = auditReason.replace(/@/g, '@\u200b');

    // --- Permission and Settings Check ---
    const settings = await db.getGuildSettings(guild.id);
    if (!settings) {
      return interaction.reply({ content: 'Guild settings not found. Please run the setup command.' });
    }

    // Bot permission check
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'I do not have permission to ban members.' });
    }

    const hasAdminPerm = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasPermission = hasAdminPerm || await db.hasPermissionLevel(guild.id, member.id, 'helper', member.roles.cache);

    if (!hasPermission) {
      return interaction.reply({ content: 'You do not have permission to ban users. Requires helper level or higher.' });
    }

    // --- Execution ---
    try {
      // Check if the user is currently in the guild
      const memberToBan = await guild.members.fetch(userToBan.id).catch(() => null);

      if (memberToBan) {
        // == LOGIC FOR WHEN USER IS IN THE SERVER ==
        if (memberToBan.id === member.id) {
          return interaction.reply({ content: 'You cannot ban yourself.' });
        }
        if (memberToBan.id === interaction.client.user.id) {
          return interaction.reply({ content: 'I cannot ban myself.' });
        }
        if (!memberToBan.bannable) {
          return interaction.reply({ content: 'I cannot ban that user. They may have a higher role than me or I lack ban permissions.' });
        }
      }

      // == BANNING LOGIC (WORKS FOR BOTH CASES) ==
      await interaction.deferReply();

      await guild.members.ban(userToBan.id, { reason: auditReason, days: 0 });

      await interaction.editReply({
        content: `Successfully banned **${userToBan.tag}** (${userToBan.id}). Reason: ${displayReason}`,
      });

      // --- Logging ---
      // Use guild-specific action log from DB only (do not fallback to env)
      const logChannelId = settings.ch_actionlog ?? settings.ch_actionLog;
      if (!logChannelId) {
        console.error(`[ERROR] No action log configured for guild ${guild.id}. Cannot log ban for ${userToBan.id}`);
      } else {
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
          console.error(`[ERROR] Configured action log channel ${logChannelId} for guild ${guild.id} not found or inaccessible.`);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp?.({ content: 'Ban recorded but failed to send to action log channel (configured channel missing).' }).catch(() => {});
            } else {
              await interaction.reply?.({ content: 'Ban recorded but failed to send to action log channel (configured channel missing).' }).catch(() => {});
            }
          } catch (_) {}
        } else {
          const embed = new EmbedBuilder()
            .setTitle('User Banned')
            .setColor('#FF0000') // Red
            .addFields(
              { name: 'User', value: `${userToBan.tag} (${userToBan.id})`, inline: false },
              { name: 'Moderator', value: `${member.user.tag} (${member.id})`, inline: false },
              { name: 'Reason', value: displayReason, inline: false }
            )
            .setTimestamp();

          await logChannel.send({ embeds: [embed] }).catch(err => {
            console.error(`[ERROR] Failed to send ban log to channel ${logChannelId} for guild ${guild.id}:`, err);
          });
        }
      }

    } catch (error) {
      console.error(`Failed to ban ${userToBan.tag}:`, error);
      // Check if we already replied or deferred
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'An unexpected error occurred. The user might have an invalid ID or I may lack permissions.' });
      } else {
        await interaction.reply({ content: 'An unexpected error occurred. The user might have an invalid ID or I may lack permissions.' });
      }
    }
  }
};