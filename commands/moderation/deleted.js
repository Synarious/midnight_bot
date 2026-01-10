const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../data/database');

let schemaEnsured = false;

async function ensureDeletedMessagesSchema() {
  if (schemaEnsured) return;
  schemaEnsured = true;

  await db.query(
    `
    CREATE TABLE IF NOT EXISTS deleted_messages (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
    [],
    { context: 'cmd:deleted:ensureSchema' }
  );

  await db.query(
    'CREATE INDEX IF NOT EXISTS idx_deleted_messages_guild_user_time ON deleted_messages (guild_id, user_id, deleted_at DESC)',
    [],
    { context: 'cmd:deleted:ensureSchema:index' }
  );
}

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

    await ensureDeletedMessagesSchema();

    // Query deleted messages for this guild and user, most recent first, limit 10
    const result = await db.query(
      `
      SELECT
        content,
        deleted_at
      FROM deleted_messages
      WHERE guild_id = $1 AND user_id = $2
      ORDER BY deleted_at DESC
      LIMIT 10
    `,
      [interaction.guild.id, targetUser.id],
      { rateKey: interaction.guild.id, context: 'cmd:deleted' }
    );

    const rows = result?.rows || [];

    if (!rows.length) {
      return interaction.reply({ content: `No deleted messages found for ${targetUser.tag}.`, ephemeral: true });
    }

    // Build description with message previews and timestamps
    const description = rows.map((row, i) => {
      const content = row.content || '';
      const preview = content.length > 256 ? content.slice(0, 253) + '...' : content;
      const time = row.deleted_at ? new Date(row.deleted_at).toLocaleString() : '—';
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


  // Rate limit: 3 seconds 
  rateLimit: 3000,
};