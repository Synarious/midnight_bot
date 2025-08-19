const { Client, GatewayIntentBits } = require('discord.js');
const { getLeaveChannelId } = require('../../data/database.js');  // Import your database handling function

module.exports = {
  name: 'guildMemberRemove',
  once: false,
  async execute(member) {
    try {
      // Fetch the log channel ID from your database
      const airlockChannelID = await getLeaveChannelId(member.guild.id, 'ch_airlockLeave');

      if (!airlockChannelID) {
        console.log(`No airlock channel set for guild: ${member.guild.id}`);
        return;
      }

      // Define the emoji to use
      const emoji = '<a:guildMemberRemove:1392253100038946816>'; // Replace 'airlockdoor' with actual emoji name if different

      // Get the current date in a human-readable format
      const createdAt = new Date(member.user.createdAt).toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      });

      // Get the server's member count
      const memberCount = member.guild.memberCount;

      // Get the member's username and global name
      const username = member.user.username;
      const globalName = member.user.globalName || '';

      // Formulate the message
      const message = `${emoji} <@${member.id}> \`\`${username}\`\` | \`\`${globalName}\`\` | Created: [${createdAt}] | Member #${memberCount}`;

      // Fetch the airlock channel
      const channel = member.guild.channels.cache.get(airlockChannelID);

      if (channel) {
        // Send the Leave message to the airlock channel
        channel.send(message);
      } else {
        console.log(`Channel with ID ${airlockChannelID} not found in guild: ${member.guild.id}`);
      }
    } catch (error) {
      console.error('Error in guildMemberRemove event:', error);
    }
  }
};
