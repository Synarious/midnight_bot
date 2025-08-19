const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const { db } = require('../../data/database.js');

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

    // Fetch roles from the guild settings
    const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
    const { roles_admin, roles_mod, ch_actionLog } = settings;

    // Check if the message sender has admin or mod role
    const hasPermission = member.roles.cache.some(role => roles_admin.includes(role.id) || roles_mod.includes(role.id));
    if (!hasPermission) {
      return interaction.reply('You do not have permission to unmute users.');
    }

    // Get the mute details from the database
    const muteRecord = db.prepare('SELECT * FROM muted_users WHERE guild_id = ? AND user_id = ? ORDER BY mute_id DESC LIMIT 1')
      .get(guild.id, userToUnmute.id);

    if (!muteRecord) {
      return interaction.reply('This user is not muted.');
    }

    // Restore the user's roles
    const previousRoles = JSON.parse(muteRecord.roles);
    const userToUnmuteMember = guild.members.cache.get(userToUnmute.id);
    userToUnmuteMember.roles.set(previousRoles);

    // Update mute expiration to 1 minute before
    const updatedExpires = new Date(Date.now() - 60000).toISOString();
    db.prepare('UPDATE muted_users SET expires = ? WHERE mute_id = ?')
      .run(updatedExpires, muteRecord.mute_id);

    // Send DM if it's not disabled
    try {
      await userToUnmuteMember.send(`You have been unmuted in ${guild.name}. Reason: ${reason}`);
    } catch (error) {
      console.error(`Failed to send DM to ${userToUnmuteMember.user.tag}`);
    }

    // Log action in the action log channel
    const actionLogChannel = guild.channels.cache.get(ch_actionLog);
    if (actionLogChannel) {
      const embed = new MessageEmbed()
        .setTitle('User Unmuted')
        .addField('Unmuted User', userToUnmuteMember.user.tag)
        .addField('Reason', reason)
        .addField('Actioned by', member.user.tag)
        .setColor('#00ff00')
        .setTimestamp();
      actionLogChannel.send({ embeds: [embed] });
    }

    console.log(`Unmuted ${userToUnmuteMember.user.tag} in ${guild.name}. Reason: ${reason}`);
    return interaction.reply({ content: `Successfully unmuted ${userToUnmuteMember.user.tag} for: ${reason}`, ephemeral: true });
  }
};
