const { EmbedBuilder, Events } = require('discord.js');
// Make sure this path is correct for your project structure
const { getVoiceLogChannelId } = require('../../data/database.js'); 

// --- TROUBLESHOOTING ---
// Set to 'true' to see detailed logs in your console about what this event is doing.
// Set to 'false' once everything is working correctly.
const ENABLE_DEBUG_LOGGING = false;

const log = (message) => {
    if (ENABLE_DEBUG_LOGGING) {
        console.log(`[DEBUG | VoiceStateUpdate] ${message}`);
    }
};

module.exports = {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState, newState) {
        log('Event triggered.');

        // Check if the member is a bot
        if (newState.member.user.bot) {
            log(`Event ignored: Member is a bot (${newState.member.user.tag}).`);
            return;
        }

        // Check if the event is a mute, deafen, stream, etc. (i.e., no channel change)
        if (newState.channelId === oldState.channelId) {
            log(`Event ignored: No channel change detected for ${newState.member.user.tag}. (Likely a mute/deafen)`);
            return;
        }

        try {
            const guild = newState.guild;
            log(`Processing event for guild: ${guild.name} (${guild.id})`);
            
            // --- DATABASE CHECK ---
            const logChannelId = await getVoiceLogChannelId(guild.id, 'ch_voicelog');
            log(`Database returned Log Channel ID: ${logChannelId}`);

            if (!logChannelId) {
                log('Exiting: No voice log channel ID is set in the database for this guild.');
                return;
            }

            // --- CHANNEL FETCH CHECK ---
            const logChannel = guild.channels.cache.get(logChannelId);
            if (!logChannel) {
                log(`Exiting: Could not find the channel with ID ${logChannelId} in the guild's cache.`);
                return;
            }
            log(`Successfully found log channel: #${logChannel.name}`);


            const member = newState.member;
            const timestamp = `<t:${Math.floor(Date.now() / 1000)}:R>`;

            log(`State Change Details: User: ${member.user.tag}, Old Channel: ${oldState.channel?.name || 'None'}, New Channel: ${newState.channel?.name || 'None'}`);

            // Case 1: User JOINS a voice channel
            if (!oldState.channelId && newState.channelId) {
                log('Action detected: USER JOINED.');
                const channel = newState.channel;
                const joinEmbed = new EmbedBuilder()
                    .setColor(0x00FF00) // Green
                    .setTitle('🎤 Voice Channel Joined')
                    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                    .setDescription([
                        `- **User:** <@${member.id}>`,
                        `- **Channel:** ${channel.name}`,
                        `- **Time:** ${timestamp}`
                    ].join('\n'))
                    .setFooter({ text: `User ID: ${member.id}` })
                    .setTimestamp();

                await logChannel.send({ embeds: [joinEmbed] });
                log(`Successfully sent 'JOIN' embed to #${logChannel.name}.`);
            }

            // Case 2: User LEAVES a voice channel
            if (oldState.channelId && !newState.channelId) {
                log('Action detected: USER LEFT.');
                const channel = oldState.channel;
                const leaveEmbed = new EmbedBuilder()
                    .setColor(0xFF0000) // Red
                    .setTitle('🎤 Voice Channel Left')
                    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                    .setDescription([
                        `- **User:** <@${member.id}>`,
                        `- **Channel:** ${channel.name}`,
                        `- **Time:** ${timestamp}`
                    ].join('\n'))
                    .setFooter({ text: `User ID: ${member.id}` })
                    .setTimestamp();
                    
                await logChannel.send({ embeds: [leaveEmbed] });
                log(`Successfully sent 'LEAVE' embed to #${logChannel.name}.`);
            }

            // Case 3: User SWITCHES voice channels
            if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                log('Action detected: USER SWITCHED.');
                const oldChannel = oldState.channel;
                const newChannel = newState.channel;
                const switchEmbed = new EmbedBuilder()
                    .setColor(0xFFA500) // Orange
                    .setTitle('🎤 Switched Voice Channel')
                    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                    .setDescription([
                        `- **User:** <@${member.id}>`,
                        `- **Left:** ${oldChannel.name}`,
                        `- **Joined:** ${newChannel.name}`,
                        `- **Time:** ${timestamp}`
                    ].join('\n'))
                    .setFooter({ text: `User ID: ${member.id}` })
                    .setTimestamp();

                await logChannel.send({ embeds: [switchEmbed] });
                log(`Successfully sent 'SWITCH' embed to #${logChannel.name}.`);
            }

        } catch (error) {
            console.error('--- ERROR IN voiceStateUpdate EVENT ---');
            console.error(error);
        }
    }
};