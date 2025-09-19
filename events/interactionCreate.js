const { Events, MessageFlags, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        try {
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.slashCommands.get(interaction.commandName);

                if (!command) {
                    console.error(`No slash command matching ${interaction.commandName} was found.`);
                    return;
                }

                // Attach DB to interaction
                interaction.client.botStorage = require('../data/database.js'); // Ensure correct path
                await command.execute(interaction);

            } else if (interaction.isButton()) {
                const customId = interaction.customId;

                if (customId.startsWith('showFlaggedMessages_')) {
                    const userId = customId.split('_')[1];
                    const dbModule = require('../data/database.js');

                    // Fetch last 5 filtered messages
                    const result = await dbModule.pool.query(`
                        SELECT timestamp, channel_id 
                        FROM user_modlog
                        WHERE guild_id = $1 AND user_id = $2
                        ORDER BY timestamp DESC
                        LIMIT 5
                    `, [interaction.guild.id, userId]);
                    
                    if (!result.rows.length) {
                        return interaction.reply({ content: 'No flagged messages found for that user.', ephemeral: true });
                    }
                    
                    const flaggedMessages = result.rows;

                    if (!flaggedMessages || flaggedMessages.length === 0) {
                        return interaction.reply({ content: 'No flagged messages found for that user.', ephemeral: true });
                    }

                    const fields = result.rows.map((msg, i) => {
                        const timeString = new Date(msg.timestamp).toLocaleString();
                        const channelMention = `<#${msg.channel_id}>`;
                        return {
                            name: `Message ${i + 1} (${timeString})`,
                            value: `Channel: ${channelMention}\nMessage was flagged.`,
                        };
                    });

                    const embed = new EmbedBuilder()
                        .setTitle(`Last 5 Flagged Messages for <@${userId}>`)
                        .setColor(0xFFA500)
                        .addFields(fields)
                        .setTimestamp();

                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
            }
        } catch (error) {
            console.error('Error handling interaction:', error);

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while processing your interaction!', flags: MessageFlags.Ephemeral }).catch(() => { });
            } else {
                await interaction.reply({ content: 'There was an error while processing your interaction!', flags: MessageFlags.Ephemeral }).catch(() => { });
            }
        }
    },
};
