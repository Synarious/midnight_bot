const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const { db } = require('../../data/database.js');

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
    const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
    if (!settings) {
      return interaction.reply({ content: 'Guild settings not found in the database.', ephemeral: true });
    }

    const { roles_admin, roles_mod, ch_actionLog } = settings;

    // Check permissions
    const hasPermission = member.roles.cache.some(role =>
      roles_admin.includes(role.id) || roles_mod.includes(role.id)
    );
    if (!hasPermission) {
      return interaction.reply({ content: 'You do not have permission to ban users.', ephemeral: true });
    }

    // Ensure the user is still in the guild
    const userToBanMember = guild.members.cache.get(userToBan.id);
    if (!userToBanMember) {
      return interaction.reply({ content: 'User not found in the guild.', ephemeral: true });
    }

    try {
      // Ban the user and delete 3 days of messages across all channels
      await userToBanMember.ban({ days: 3, reason });

      // Public announcement in the channel
      await channel.send(`${userToBan.tag} has been **banned** by ${member.user.tag}`);

      // Log to action log
      const actionLogChannel = guild.channels.cache.get(ch_actionLog);
      if (actionLogChannel) {
        const embed = new MessageEmbed()
          .setTitle('User Banned')
          .addField('Banned User', `${userToBan.tag} (${userToBan.id})`, true)
          .addField('Reason', reason, true)
          .addField('Banned By', `${member.user.tag} (${member.user.id})`, true)
          .setColor('#ff0000')
          .setTimestamp();

        actionLogChannel.send({ embeds: [embed] });
      }

      // Ephemeral reply to mod
      return interaction.reply({
        content: `Successfully banned ${userToBan.tag} and deleted their messages from the past 3 days.`,
        ephemeral: true,
      });

    } catch (error) {
      console.error(`Failed to ban ${userToBan.tag}:`, error);
      return interaction.reply({
        content: 'There was an error trying to ban that user.',
        ephemeral: true,
      });
    }
  }
};
