const { Events, EmbedBuilder } = require('discord.js');
const MemberCacheManager = require('./MemberCacheManager');

// Configuration
const LOG_CHANNEL_ID = '1378816362721579049'; // Channel where alerts are sent
const MENTION_ROLE_ID = ''; // Role to mention

/**
 * Logs the detected impersonation to the configured channel.
 */
async function logImpersonation({ member, newName, oldName, changeType, potentialVictim, victimNames, score }) {
    const logChannel = await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel || !logChannel.isTextBased()) {
        console.error(`[ImpersonationCheck] Log channel with ID ${LOG_CHANNEL_ID} not found or is not a text channel.`);
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🚨 Potential Impersonation Detected 🚨')
        .setDescription('A user changed their name to something very similar to another member.')
        .addFields(
            { name: 'Member', value: `${member} (${member.user.tag})`, inline: true },
            { name: 'Change Type', value: changeType, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Old Name', value: `\`${oldName || 'None'}\``, inline: true },
            { name: 'New Name', value: `\`${newName}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true }
        )
        .setFooter({ text: `Match Score: ${score.toFixed(4)} (Closer to 0 is a better match)` })
        .setTimestamp();

    if (potentialVictim) {
        embed.addFields({
            name: 'Potentially Impersonating',
            value: `${potentialVictim} (${potentialVictim.user.tag})`
        });
    } else {
        embed.addFields({
            name: 'Potentially Impersonating',
            value: `*User not found, but matched names:*\n\`${victimNames.join(', ')}\``
        });
    }

    try {
        await logChannel.send({
            content: `<@&${MENTION_ROLE_ID}>`,
            embeds: [embed],
        });
    } catch (error) {
        console.error(`[ImpersonationCheck] Failed to send log message:`, error);
    }
}

/**
 * Checks if the new name matches any other member's names.
 */
async function checkImpersonation(member, newName, oldName, changeType) {
    if (!newName) return;

    const guild = member.guild;
    const fuse = await MemberCacheManager.getFuseForGuild(guild);
    if (!fuse) {
        console.warn(`[ImpersonationCheck] No cache for ${guild.name}, skipping check.`);
        return;
    }

    const results = fuse.search(newName);
    const potentialMatches = results.filter(result => result.item.id !== member.id);

    if (potentialMatches.length > 0) {
        const bestMatch = potentialMatches[0];
        const impersonatedMember = await guild.members.fetch(bestMatch.item.id).catch(() => null);

        await logImpersonation({
            member,
            newName,
            oldName,
            changeType,
            potentialVictim: impersonatedMember,
            victimNames: bestMatch.item.names,
            score: bestMatch.score,
        });
    }
}

// Exported module
module.exports = {
    name: 'impersonationCheck',

    /**
     * Called once when the bot is ready.
     */
    async initialize(client) {
        await MemberCacheManager.initialize(client);
    },

    // --- Discord Events ---

    [Events.GuildMemberAdd]: {
        name: Events.GuildMemberAdd,
        async execute(member) {
            MemberCacheManager.addMember(member);
            console.log(`[ImpersonationCheck] Added ${member.user.tag} to ${member.guild.name}`);
        }
    },

    [Events.GuildMemberRemove]: {
        name: Events.GuildMemberRemove,
        async execute(member) {
            MemberCacheManager.removeMember(member);
            console.log(`[ImpersonationCheck] Removed ${member.user.tag} from ${member.guild.name}`);
        }
    },

    [Events.GuildMemberUpdate]: {
        name: Events.GuildMemberUpdate,
        async execute(oldMember, newMember) {
            if (oldMember.nickname !== newMember.nickname) {
                await checkImpersonation(newMember, newMember.nickname, oldMember.nickname, 'Nickname');
            }
            MemberCacheManager.updateMember(newMember);
        }
    },

    [Events.UserUpdate]: {
        name: Events.UserUpdate,
        async execute(oldUser, newUser, client) {
            const changedUsername = oldUser.username !== newUser.username;
            const changedGlobal = oldUser.globalName !== newUser.globalName;

            if (!changedUsername && !changedGlobal) return;

            const changeType = changedUsername ? 'Username' : 'Global Name';
            const newName = changedUsername ? newUser.username : newUser.globalName;
            const oldName = changedUsername ? oldUser.username : oldUser.globalName;

            for (const guild of client.guilds.cache.values()) {
                const member = guild.members.cache.get(newUser.id);
                if (member) {
                    await checkImpersonation(member, newName, oldName, changeType);
                    MemberCacheManager.updateMember(member);
                }
            }
        }
    },
};
