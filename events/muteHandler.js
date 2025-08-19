const { db } = require('../data/database');
const { MessageEmbed } = require('discord.js');

module.exports = (client) => {
  client.on('guildMemberAdd', async (member) => {
    const muteRecord = db.prepare(`
      SELECT * FROM muted_users WHERE guild_id = ? AND user_id = ? AND expires > ?
    `).get(member.guild.id, member.id, Date.now());

    if (muteRecord) {
      const reason = muteRecord.reason || 'No reason provided';
      // Remove all roles and mute the user
      await member.roles.set([]);

      const actionLogChannel = member.guild.channels.cache.get(muteRecord.ch_actionLog);
      if (actionLogChannel) {
        const embed = new MessageEmbed()
          .setTitle('User Muted on Join')
          .addField('Muted User', member.user.tag)
          .addField('Reason', reason)
          .setColor('#ff0000')
          .setTimestamp();
        actionLogChannel.send({ embeds: [embed] });
      }

      console.log(`Muted ${member.user.tag} on join in ${member.guild.name}. Reason: ${reason}`);
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const muteRecord = db.prepare(`
      SELECT * FROM muted_users WHERE guild_id = ? AND user_id = ? AND expires > ?
    `).get(message.guild.id, message.author.id, Date.now());

    if (muteRecord) {
      // Remove the message if muted
      message.delete();
      console.log(`Deleted message from ${message.author.tag} due to mute.`);
    }
  });
};
