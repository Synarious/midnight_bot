const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deleted')
    .setDescription('Show up to 10 recent deleted messages for a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to look up')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const modMsgDb = interaction.client.mod_msg_db;

    if (!modMsgDb) {
      return interaction.reply({ content: 'Database is not initialized.', ephemeral: true });
    }

    // Query deleted messages for this guild and user, most recent first, limit 10
    const rows = modMsgDb.prepare(`
      SELECT content, timestamp 
      FROM deleted_messages 
      WHERE guild_id = ? AND user_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 10
    `).all(interaction.guild.id, targetUser.id);

    if (!rows.length) {
      return interaction.reply({ content: `No deleted messages found for ${targetUser.tag}.`, ephemeral: true });
    }

    // Build description with message previews and timestamps
    const description = rows.map((row, i) => {
      const preview = row.content.length > 256 ? row.content.slice(0, 253) + '...' : row.content;
      const time = new Date(row.timestamp).toLocaleString();
      return `**${i + 1}.** [${time}]\n${preview}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`Deleted Messages for ${targetUser.tag}`)
      .setDescription(description)
      .setColor(0xFF0000)
      .setFooter({ text: `Showing up to 10 recent deleted messages` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};