const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const { db } = require('../../data/database.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a user')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('User to mute')
        .setRequired(true)
    )
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason for muting')
        .setMaxLength(512)
    ),
  
  async execute(interaction) {
    const { guild, member } = interaction;
    const userToMute = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Fetch roles from the guild settings
    const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
    const { roles_admin, roles_mod, ch_actionLog } = settings;

    // Check if the message sender has admin or mod role
    const hasPermission = member.roles.cache.some(role => roles_admin.includes(role.id) || roles_mod.includes(role.id));
    if (!hasPermission) {
      return interaction.reply('You do not have permission to mute users.');
    }

    // Fetch the user to mute
    const userToMuteMember = guild.members.cache.get(userToMute.id);
    if (!userToMuteMember) {
      return interaction.reply('User not found in the guild.');
    }

    const currentRoles = userToMuteMember.roles.cache.map(role => role.id);

    // Log the mute in the database
    const muteId = db.prepare(`
      INSERT INTO muted_users (guild_id, user_id, reason, roles, actioned_by, length, expires, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(guild.id, userToMute.id, reason, JSON.stringify(currentRoles), member.id, 'Indefinite', 'Never', Date.now());

    // Remove all roles from the user
    userToMuteMember.roles.set([]);

    // Send DM if it's not disabled
    try {
      await userToMuteMember.send(`You have been muted in ${guild.name} for: ${reason}`);
    } catch (error) {
      console.error(`Failed to send DM to ${userToMute.tag}`);
    }

    // Log action in the action log channel
    const actionLogChannel = guild.channels.cache.get(ch_actionLog);
    if (actionLogChannel) {
      const embed = new MessageEmbed()
        .setTitle('User Muted')
        .addField('Muted User', userToMute.tag)
        .addField('Reason', reason)
        .addField('Actioned by', member.user.tag)
        .setColor('#ff0000')
        .setTimestamp();
      actionLogChannel.send({ embeds: [embed] });
    }

    console.log(`Muted ${userToMute.tag} in ${guild.name}. Reason: ${reason}`);
    return interaction.reply({ content: `Successfully muted ${userToMute.tag} for: ${reason}`, ephemeral: true });
  }
};
