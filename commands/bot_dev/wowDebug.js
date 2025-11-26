const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getSelections } = require('../../features/onboarding/wowGuild');
const axios = require('axios');

// Re-implementing basic token fetch here to avoid circular deps or complex exports, 
// or we could export it from wowGuild.js if we wanted to be cleaner.
// For a dev command, this is acceptable.
async function getBlizzardToken() {
    const clientId = process.env.BNET_CLIENT_ID;
    const clientSecret = process.env.BNET_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    try {
        const response = await axios.post('https://us.battle.net/oauth/token', 'grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data.access_token;
    } catch (e) {
        console.error('Failed to get token', e);
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wow-debug')
        .setDescription('Debug WoW API connection and roster')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildSlug = (process.env.WOW_GUILD_SLUG || 'dawnbound').toLowerCase();
        const realmSlug = (process.env.WOW_GUILD_REALM_SLUG || 'moon-guard').toLowerCase();
        const region = 'us';
        const namespace = 'profile-us';
        const locale = 'en_US';

        try {
            const token = await getBlizzardToken();
            if (!token) {
                return interaction.editReply('❌ Failed to get Blizzard Access Token. Check BNET_CLIENT_ID and BNET_CLIENT_SECRET.');
            }

            const url = `https://${region}.api.blizzard.com/data/wow/guild/${realmSlug}/${guildSlug}/roster`;
            
            let log = `**WoW Debug**\nURL: \`${url}\`\n`;
            
            const start = Date.now();
            const response = await axios.get(url, {
                params: { namespace, locale, access_token: token }
            });
            const duration = Date.now() - start;

            log += `✅ Status: ${response.status} (${duration}ms)\n`;
            
            const data = response.data;
            const members = data.members || data.entries || [];
            log += `Entries found: ${members.length}\n`;

            if (members.length > 0) {
                const sample = members.slice(0, 5).map(m => m.character?.name || m.name || '???').join(', ');
                log += `Sample names: ${sample}\n`;
                
                // Check for specific user if provided in options (future)
                // For now, just check for "Cephrax" as a test
                const target = 'Cephrax';
                const found = members.find(m => (m.character?.name || '').toLowerCase() === target.toLowerCase());
                log += `Lookup '${target}': ${found ? '✅ Found' : '❌ Not Found'}\n`;
            }

            await interaction.editReply(log);

        } catch (error) {
            console.error(error);
            let errorMsg = `❌ Error: ${error.message}`;
            if (error.response) {
                errorMsg += `\nStatus: ${error.response.status}`;
                errorMsg += `\nData: ${JSON.stringify(error.response.data).slice(0, 200)}`;
            }
            await interaction.editReply(errorMsg);
        }
    }
};
