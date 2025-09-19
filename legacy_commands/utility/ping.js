const { EmbedBuilder } = require('discord.js');
const os = require('os');
const db = require('../../data/database.js');

module.exports = {
    name: 'ping',
    description: 'Shows the bot latency and system status.',
    
    async execute(message, args, client) {
        try {
            // Get bot prefix
            const guildId = message.guild.id;
            const result = await db.pool.query('SELECT cmd_prefix FROM guild_settings WHERE guild_id = $1', [guildId]);
            const botPrefix = result.rows[0]?.cmd_prefix || '!';

            // Measure roundtrip latency
            const roundTrip = Date.now() - message.createdTimestamp;
            
            // Bot system stats
            const uptime = process.uptime(); // in seconds
            const memUsage = process.memoryUsage().rss / 1024 / 1024; // in MB
            const wsPing = client.ws.ping;

            const formatUptime = (seconds) => {
                const hrs = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);
                return `${hrs}h ${mins}m ${secs}s`;
            };

            // Create the embed for bot and system status
            const statusEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Bot & System Status')
                .addFields(
                    { name: '🤖 Bot Status', value: `📡 API Latency: \`${wsPing}ms\`\n📨 Roundtrip Latency: \`${roundTrip}ms\`\n🟢 Status: \`Online\`\n` },
                    { name: '🖥️ System Status', value: `🕒 Uptime: \`${formatUptime(uptime)}\`\n💾 RAM Usage: \`${memUsage.toFixed(2)} MB\`\n🧠 Platform: \`${os.platform()} (${os.arch()})\`\n` },
                    { name: '🔑 Bot Command Prefix', value: `Your bot prefix is: \`${botPrefix}\`` }
                )
                .setTimestamp()
                .setFooter({ text: 'System & Bot Health' });

            // Send the response in an embed message
            await message.reply({ embeds: [statusEmbed] });
        } catch (error) {
            console.error('❌ Error in ping command:', error);
            await message.reply('An error occurred while showing the ping stats.');
        }
    },
};