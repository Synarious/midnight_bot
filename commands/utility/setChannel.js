const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { updateGuildSetting } = require('../../data/database.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Assign a channel to a specific configuration key')
    .addStringOption(option =>
      option.setName('config_key')
        .setDescription('Configuration key to assign (must start with ch_)')
        .setRequired(true)
        .setAutocomplete(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to assign')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // 👈 Enforced at command level

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();

    const configKeys = [
      'ch_actionLog',
      'ch_kickbanLog',
      'ch_auditLog',
      'ch_airlockJoin',
      'ch_airlockLeave',
      'ch_deletedMessages',
      'ch_editedMessages',
      'ch_automod_AI',
      'ch_voiceLog',
      'ch_inviteLog',
      'ch_permanentInvites',
      'ch_memberJoin',
    ];

    const filtered = configKeys.filter(k => k.startsWith(focusedValue));
    await interaction.respond(filtered.map(key => ({ name: key, value: key })));
  },

  async execute(interaction) {
    const configKey = interaction.options.getString('config_key');
    const channel = interaction.options.getChannel('channel');
    const member = interaction.member;

    // ✅ Extra check for Administrator permissions
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ You need Administrator permissions to use this command.',
        ephemeral: true,
      });
    }

    if (!configKey.startsWith('ch_')) {
      return interaction.reply({ content: '❌ Invalid config key. Must start with `ch_`.', ephemeral: true });
    }


    // Important to prevent SQL injection, validate against a set of known keys
    const validKeys = new Set([
      'ch_actionLog',
      'ch_kickbanLog',
      'ch_auditLog',
      'ch_airlockJoin',
      'ch_airlockLeave',
      'ch_deletedMessages',
      'ch_editedMessages',
      'ch_automod_AI',
      'ch_voiceLog',
      'ch_inviteLog',
      'ch_permanentInvites',
      'ch_memberJoin',
    ]);

    if (!validKeys.has(configKey)) {
      return interaction.reply({ content: '❌ That config key is not allowed.', ephemeral: true });
    }

    const guildId = interaction.guild.id;

    if (channel.guild.id !== guildId) {
      return interaction.reply({ content: '❌ You must select a channel from this server.', ephemeral: true });
    }

    const updated = await updateGuildSetting(guildId, configKey, channel.id);
    if (!updated) {
      return interaction.reply({
        content: '❌ Failed to update the database. Please try again later.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: `✅ Set \`${configKey}\` to <#${channel.id}>.`,
      ephemeral: true,
    });
  },


  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
