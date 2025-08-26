const { getActiveMute, getExpiredMutes, deactivateMute, getAllActiveMutes } = require('../data/database.js');

const CHECK_INTERVAL = 30 * 1000; // Check for expired mutes every 30 seconds
const FAILSAFE_INTERVAL = 5 * 60 * 1000; // Failsafe check every 5 minutes

/**
 * The main entry point to initialize the mute handling timers.
 * @param {import('discord.js').Client} client The Discord client instance.
 */

/**
 * @typedef {Object} Mute
 * @property {string} mute_id
 * @property {string} mute_roleid
 * @property {string} user_id
 * @property {string} guild_id
 * @property {string} roles - JSON stringified array of role IDs
 * @property {number} expires_at - Timestamp
 */

function initialize(client) {
    console.log('[MuteHandler] Initializing...');
    
    // Start the timer to check for expired mutes and unmute users.
    setInterval(() => checkExpiredMutes(client), CHECK_INTERVAL);
    
    // Start the timer for the failsafe mechanism.
    setInterval(() => checkActiveMutesFailsafe(client), FAILSAFE_INTERVAL);
    
    console.log('[MuteHandler] Timers for expired mutes and failsafe checks have been started.');
}

/**
 * Checks for and handles expired mutes.
 * @param {import('discord.js').Client} client
 */
async function checkExpiredMutes(client) {
    try {
        const expiredMutes = await getExpiredMutes();
        if (expiredMutes.length === 0) return;

        console.log(`[MuteHandler] Found ${expiredMutes.length} expired mutes to process.`);

        for (const mute of expiredMutes) {
            const guild = await client.guilds.fetch(mute.guild_id).catch(() => null);
            if (!guild) {
                // Bot is no longer in the guild, deactivate the mute to prevent re-checking
                await deactivateMute(mute.mute_id);
                continue;
            }
            
            const member = await guild.members.fetch(mute.user_id).catch(() => null);
            if (!member) {
                // User is no longer in the guild, deactivate mute
                await deactivateMute(mute.mute_id);
                continue;
            }

            console.log(`[MuteHandler] Unmuting ${member.user.tag} in ${guild.name}.`);
            await unmuteUser(member, mute);
        }
    } catch (error) {
        console.error('[❌ MuteHandler] Error in checkExpiredMutes:', error);
    }
}

/**
 * Failsafe: Periodically checks all active mutes to ensure they are correctly applied.
 * This handles cases where a mute role was manually removed or the bot restarted.
 * @param {import('discord.js').Client} client
 */
async function checkActiveMutesFailsafe(client) {
    try {
        const allActiveMutes = await getAllActiveMutes(client);
        if (allActiveMutes.length === 0) return;

        for (const mute of allActiveMutes) {
            const guild = client.guilds.cache.get(mute.guild_id);
            if (!guild) continue;

            const settings = await require('../data/database.js').getGuildSettings(guild.id);
            if (!settings || !settings.mute_roleid) continue;

            // In a real scenario with MemberCacheManager, you might use it here for efficiency.
            // For now, we fetch from cache first, then the API as a fallback.
            let member = guild.members.cache.get(mute.user_id);
            if (!member) {
                member = await guild.members.fetch(mute.user_id).catch(() => null);
            }

            if (member && !member.roles.cache.has(settings.mute_roleid)) {
                console.log(`[MuteHandler-Failsafe] Re-applying mute to ${member.user.tag} in ${guild.name}.`);
                // Use .set() to ensure only the mute role is applied.
                await member.roles.set([settings.mute_roleid]).catch(err => {
                    console.error(`[❌ MuteHandler-Failsafe] Failed to re-apply mute for ${member.id}:`, err);
                });
            }
        }
    } catch (error) {
        console.error('[❌ MuteHandler] Error in failsafe check:', error);
    }
}


/**
 * Handles a member joining the guild to check if they should be muted.
 * @param {import('discord.js').GuildMember} member
 */
async function handleMemberJoin(member) {
    try {
        const activeMute = await getActiveMute(member.guild.id, member.id);
        if (activeMute) {
            const settings = await require('../data/database.js').getGuildSettings(member.guild.id);
            if (!settings || !settings.mute_roleid) return;

            const muteRole = member.guild.roles.cache.get(settings.mute_roleid);
            if (muteRole) {
                console.log(`[MuteHandler] Re-applying mute to returning member ${member.user.tag}.`);
                await member.roles.add(muteRole).catch(err => {
                    console.error(`[❌ MuteHandler] Failed to re-apply mute on join for ${member.id}:`, err);
                });
            }
        }
    } catch (error) {
        console.error('[❌ MuteHandler] Error in handleMemberJoin:', error);
    }
}

/**
 * Unmutes a user by restoring their original roles.
 * @param {import('discord.js').GuildMember} member
 * @param {object} muteRecord The mute record from the database.
 */
async function unmuteUser(member, muteRecord) {
    try {
        const originalRoles = JSON.parse(muteRecord.roles);
        // Filter out roles that may have been deleted since the mute was applied.
        const rolesToRestore = originalRoles.filter(roleId => member.guild.roles.cache.has(roleId));

        await member.roles.set(rolesToRestore);
        await deactivateMute(muteRecord.mute_id);
        
        console.log(`[MuteHandler] Successfully unmuted ${member.user.tag}.`);

        try {
            await member.send(`Your mute in **${member.guild.name}** has expired. You have been unmuted.`);
        } catch (dmError) {
             console.log(`[MuteHandler] Could not DM user ${member.id} about their unmute.`);
        }
    } catch (error) {
        console.error(`[❌ MuteHandler] Failed to unmute user ${member.id}:`, error);
        // If the unmute fails (e.g., permissions), we don't deactivate the record,
        // so the system will try again on the next interval.
    }
}

module.exports = {
    initialize,
    handleMemberJoin,
};