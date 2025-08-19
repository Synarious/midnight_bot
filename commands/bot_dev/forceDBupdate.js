const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../../data/database.js');

const ALLOWED_USER_ID = '134118092082118657'; // 🔒 Set your developer ID here

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcedbupdate')
    .setDescription('Force the database to update: adds missing guilds and columns. (Developer only)'),

  async execute(interaction) {
    // 🔒 Permission check
    if (interaction.user.id !== ALLOWED_USER_ID) {
      return interaction.reply({
        content: '❌ You do not have permission to run this command.',
        ephemeral: true
      });
    }

    const client = interaction.client;

    try {
      await interaction.deferReply({ ephemeral: true });

      // Step 1: Get existing columns
      const existingColumns = db.prepare(`PRAGMA table_info(guild_settings);`).all()
        .map(col => col.name);

      const desiredSchema = {
        guild_id: "TEXT PRIMARY KEY",
        cmd_prefix: "TEXT DEFAULT '!'",
        bot_enabled: "BOOLEAN DEFAULT 1",
        roles_admin: "TEXT DEFAULT '[]'",
        roles_mod: "TEXT DEFAULT '[]'",
        roles_trust: "TEXT DEFAULT '[]'",
        roles_untrusted: "TEXT DEFAULT '[]'",
        enable_automod: "BOOLEAN DEFAULT 1",
        enable_openAI: "BOOLEAN DEFAULT 1",
        mute_roleID: "TEXT",
        mute_rolesRemoved: "TEXT DEFAULT '[]'",
        mute_immuneUserIDs: "TEXT DEFAULT '[]'",
        kick_immuneRoles: "TEXT DEFAULT '[]'",
        kick_immuneUserID: "TEXT DEFAULT '[]'",
        ban_immuneRoles: "TEXT DEFAULT '[]'",
        ban_immuneUserID: "TEXT DEFAULT '[]'",
        ch_actionLog: "TEXT",
        ch_kickbanLog: "TEXT",
        ch_auditLog: "TEXT",
        ch_airlockJoin: "TEXT",
        ch_airlockLeave: "TEXT",
        ch_deletedMessages: "TEXT",
        ch_editedMessages: "TEXT",
        ch_automod_AI: "TEXT",
        ch_voiceLog: "TEXT",
        ch_categoryIgnoreAutomod: "TEXT DEFAULT '[]'",
        ch_channelIgnoreAutomod: "TEXT DEFAULT '[]'"
      };

      // Step 2: Add missing columns
      const addedColumns = [];
      for (const [column, type] of Object.entries(desiredSchema)) {
        if (!existingColumns.includes(column)) {
          db.prepare(`ALTER TABLE guild_settings ADD COLUMN ${column} ${type}`).run();
          addedColumns.push(column);
        }
      }

      // Step 3: Ensure all guilds have rows
      const guilds = client.guilds.cache;
      const insertedGuilds = [];

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)
      `);

      for (const [guildId] of guilds) {
        const existing = db.prepare('SELECT guild_id FROM guild_settings WHERE guild_id = ?').get(guildId);
        if (!existing) {
          insertStmt.run(guildId);
          insertedGuilds.push(guildId);
        }
      }

      // Step 4: Reply
      const reply = [
        `✅ **Database update complete.**`,
        `${insertedGuilds.length} new guild(s) added.`,
        `${addedColumns.length} column(s) added.`,
        addedColumns.length > 0 ? `➕ Columns: \`${addedColumns.join(', ')}\`` : null
      ].filter(Boolean).join('\n');

      await interaction.editReply({ content: reply });

    } catch (err) {
      console.error('Error during forcedbupdate:', err);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ An error occurred while updating the database.');
      } else {
        await interaction.reply({ content: '❌ Error occurred.', ephemeral: true });
      }
    }
  }
};
