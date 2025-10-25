const db = require('../../data/database.js');

/**
 * Handle showFlaggedMessages button interaction
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleButton(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'showFlaggedMessages') return false;

    try {
        await interaction.deferReply({ ephemeral: true });

        const result = await db.query(
            'SELECT id, user_id, username, content, flag_type, timestamp FROM flagged_messages WHERE guild_id = $1 ORDER BY timestamp DESC LIMIT 10',
            [interaction.guild.id],
            { rateKey: interaction.guild.id, context: 'showFlaggedMessages' }
        );

        if (!result.rows || result.rows.length === 0) {
            await interaction.editReply({ content: 'No flagged messages found.' });
            return true;
        }

        const MAX_LENGTH = 1900;
        let text = '**Recent Flagged Messages:**\n\n';
        for (const row of result.rows) {
            const ts = new Date(row.timestamp).toLocaleString();
            const content = row.content && row.content.length > 80 
                ? row.content.slice(0, 77) + '...' 
                : (row.content || '(no content)');
            
            const line = `• **${row.username || row.user_id}** (${row.flag_type}) - ${ts}\n  ${content}\n\n`;
            if ((text + line).length > MAX_LENGTH) break;
            text += line;
        }

        await interaction.editReply({ content: text });
        return true;

    } catch (error) {
        console.error('[moderation] Error in showFlaggedMessages:', error);
        await interaction.editReply({ content: 'An error occurred while fetching flagged messages.' }).catch(() => {});
        return false;
    }
}

module.exports = {
    handleButton,

    // Rate limits for moderation interactions
    rateLimits: {
        button: 3000,  // 3 seconds between button interactions (e.g., showFlaggedMessages)
    },
};
