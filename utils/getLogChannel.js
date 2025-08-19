function getLogChannel(guild) {
    // Read the channel ID directly from the environment variables
    return guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
}