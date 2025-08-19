const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Get the image URL of a custom emoji.')
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('The custom emoji (e.g. <:name:id> or <a:name:id>)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const emojiInput = interaction.options.getString('emoji');

    // Regex to match custom emoji format
    const emojiRegex = /<(a?):(\w+):(\d+)>/;
    const match = emojiInput.match(emojiRegex);

    if (!match) {
      return interaction.reply({
        content: '❌ Please provide a valid custom Discord emoji (e.g. `<:smile:123456789012345678>`).',
        ephemeral: true
      });
    }

    const isAnimated = match[1] === 'a';
    const emojiName = match[2];
    const emojiId = match[3];

    const fileExtension = isAnimated ? 'gif' : 'png';
    const emojiURL = `https://cdn.discordapp.com/emojis/${emojiId}.${fileExtension}`;

    return interaction.reply({
      content: `🔗 Emoji URL for \`${emojiName}\`: ${emojiURL}`
    });
  }
};
