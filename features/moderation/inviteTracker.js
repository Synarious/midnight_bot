const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getGuildSettings, pool, resolveEnabledLogChannelId } = require('../../data/database.js');

/**
 * Invite tracking module that monitors invite creation/usage and logs to database
 */
class InviteTracker {
    constructor() {
        this.guildInvites = new Map(); // Cache of current invites per guild
    }

    /**
     * Initialize invite tracking for all guilds
     * @param {import('discord.js').Client} client 
     */
    async initialize(client) {
        console.log('[InviteTracker] Initializing invite tracking...');
        
        // Cache current invites for all guilds
        for (const guild of client.guilds.cache.values()) {
            await this.cacheGuildInvites(guild);
        }

        console.log('[InviteTracker] Invite tracking initialized.');
    }

    /**
     * Cache all current invites for a guild
     * @param {import('discord.js').Guild} guild 
     */
    async cacheGuildInvites(guild) {
        try {
            const invites = await guild.invites.fetch();
            this.guildInvites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
        } catch (error) {
            console.error(`[InviteTracker] Failed to cache invites for ${guild.name}:`, error);
        }
    }

    /**
     * Handle invite creation
     * @param {import('discord.js').Invite} invite 
     */
    async handleInviteCreate(invite) {
        try {
            const { guild, inviter, channel, maxUses, maxAge, createdTimestamp } = invite;
            if (!guild || !inviter) return;

            const settings = await getGuildSettings(guild.id);
            if (!settings) return;

            // Update cache
            const guildInviteCache = this.guildInvites.get(guild.id) || new Map();
            guildInviteCache.set(invite.code, 0);
            this.guildInvites.set(guild.id, guildInviteCache);

            // Log to database with comprehensive data
            await this.logInviteToDatabase({
                guildId: guild.id,
                userId: null, // No user joined yet
                utcTime: new Date(createdTimestamp).toISOString(),
                inviteCode: invite.code,
                inviteCreator: inviter.id,
                creatorId: inviter.id,
                creatorName: inviter.username,
                channelId: channel.id,
                channelName: channel.name,
                maxUses: maxUses || 0,
                temporary: maxAge > 0,
                expiresAt: maxAge > 0 ? new Date(createdTimestamp + maxAge * 1000).toISOString() : null,
                usesCount: 0
            });

            // Create embed for invite creation
            const embed = new EmbedBuilder()
                .setTitle('🔗 Invite Created')
                .setColor('#00FF00')
                .addFields(
                    { name: 'Creator', value: `${inviter.tag} (${inviter.id})`, inline: true },
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Code', value: invite.code, inline: true },
                    { name: 'Max Uses', value: maxUses === 0 ? 'Unlimited' : maxUses.toString(), inline: true },
                    { name: 'Expires', value: maxAge === 0 ? 'Never' : `<t:${Math.floor((createdTimestamp + maxAge * 1000) / 1000)}:R>`, inline: true },
                    { name: 'URL', value: `https://discord.gg/${invite.code}`, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: `Invite: ${invite.code}` });

            // Send to invite log channel
            const inviteLogChannelId = resolveEnabledLogChannelId(settings, 'ch_invitelog');
            if (inviteLogChannelId) {
                const logChannel = await guild.channels.fetch(inviteLogChannelId).catch(() => null);
                if (logChannel) {
                    await logChannel.send({ embeds: [embed] }).catch(err => {
                        console.error(`[InviteTracker] Failed to send invite creation log:`, err);
                    });
                }
            }

            // Check for never-expiring invites
            if (maxAge === 0) {
                const permanentInviteChannelId = resolveEnabledLogChannelId(settings, 'ch_permanentinvites');
                if (permanentInviteChannelId && permanentInviteChannelId !== inviteLogChannelId) {
                    const permanentChannel = await guild.channels.fetch(permanentInviteChannelId).catch(() => null);
                    if (permanentChannel) {
                        const permanentEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Permanent Invite Created')
                            .setColor('#FF9900')
                            .addFields(
                                { name: 'Creator', value: `${inviter.tag} (${inviter.id})`, inline: true },
                                { name: 'Channel', value: `${channel.name}`, inline: true },
                                { name: 'Code', value: invite.code, inline: true },
                                { name: 'URL', value: `https://discord.gg/${invite.code}`, inline: false }
                            )
                            .setDescription('⚠️ This invite will never expire. Consider setting an expiration time for security.')
                            .setTimestamp();

                        await permanentChannel.send({ embeds: [permanentEmbed] }).catch(err => {
                            console.error(`[InviteTracker] Failed to send permanent invite warning:`, err);
                        });
                    }
                }
            }

        } catch (error) {
            console.error('[InviteTracker] Error handling invite creation:', error);
        }
    }

    /**
     * Handle member joining and determine which invite was used
     * @param {import('discord.js').GuildMember} member 
     */
    async handleMemberJoin(member) {
        try {
            const { guild, user } = member;
            const settings = await getGuildSettings(guild.id);
            if (!settings) return;

            // Get current invites and compare with cache
            const currentInvites = await guild.invites.fetch().catch(() => null);
            if (!currentInvites) return;

            const cachedInvites = this.guildInvites.get(guild.id) || new Map();
            let usedInvite = null;

            // Find the invite that had its use count increased
            for (const [code, invite] of currentInvites) {
                const cachedUses = cachedInvites.get(code) || 0;
                if (invite.uses > cachedUses) {
                    usedInvite = invite;
                    break;
                }
            }

            // Update cache with new invite uses
            this.guildInvites.set(guild.id, new Map(currentInvites.map(invite => [invite.code, invite.uses])));

            // If we found the used invite, log it
            if (usedInvite) {
                await this.logInviteUsage(member, usedInvite);
            } else {
                // Fallback: try to find from audit logs
                await this.handleMemberJoinFallback(member);
            }

        } catch (error) {
            console.error('[InviteTracker] Error handling member join:', error);
        }
    }

    /**
     * Fallback method to find invite usage from audit logs
     * @param {import('discord.js').GuildMember} member 
     */
    async handleMemberJoinFallback(member) {
        try {
            const { guild, user } = member;
            
            // Check audit logs for member join
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberJoin,
                limit: 10
            }).catch(() => null);

            if (auditLogs) {
                // Find the most recent join for this user
                const joinEntry = auditLogs.entries.find(entry => 
                    entry.target?.id === user.id && 
                    (Date.now() - entry.createdTimestamp) < 10000 // Within 10 seconds
                );

                if (joinEntry) {
                    // Log without specific invite
                    await this.logInviteToDatabase({
                        guildId: guild.id,
                        userId: user.id,
                        utcTime: new Date().toISOString(),
                        invite: 'UNKNOWN',
                        inviteCreator: 'UNKNOWN'
                    });

                    await this.sendJoinEmbed(member, null, 'Unknown (cache miss)');
                }
            }
        } catch (error) {
            console.error('[InviteTracker] Error in fallback join handling:', error);
        }
    }

    /**
     * Log invite usage when member joins
     * @param {import('discord.js').GuildMember} member 
     * @param {import('discord.js').Invite} invite 
     */
    async logInviteUsage(member, invite) {
        try {
            await this.logInviteToDatabase({
                guildId: member.guild.id,
                userId: member.user.id,
                utcTime: new Date().toISOString(),
                inviteCode: invite.code,
                inviteCreator: invite.inviter?.id || 'UNKNOWN',
                creatorId: invite.inviter?.id || 'UNKNOWN',
                creatorName: invite.inviter?.username || 'Unknown',
                channelId: invite.channel?.id || 'Unknown',
                channelName: invite.channel?.name || 'Unknown',
                maxUses: invite.maxUses || 0,
                temporary: invite.maxAge > 0,
                expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
                usesCount: invite.uses || 0
            });

            await this.sendJoinEmbed(member, invite, `${invite.inviter?.tag || 'Unknown'} (${invite.inviter?.id || 'Unknown'})`);
        } catch (error) {
            console.error('[InviteTracker] Error logging invite usage:', error);
        }
    }

    /**
     * Send join embed to log channel
     * @param {import('discord.js').GuildMember} member 
     * @param {import('discord.js').Invite} invite 
     * @param {string} inviterInfo 
     */
    async sendJoinEmbed(member, invite, inviterInfo) {
        try {
            const { guild, user } = member;
            const settings = await getGuildSettings(guild.id);
            const logChannelId = resolveEnabledLogChannelId(settings, 'ch_memberjoin');
            if (!logChannelId) return;

            const embed = new EmbedBuilder()
                .setTitle('👋 Member Joined')
                .setColor('#00FF00')
                .addFields(
                    { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                    { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Invite Used', value: invite?.code || 'Unknown', inline: true },
                    { name: 'Invite Creator', value: inviterInfo, inline: true },
                    { name: 'Invite Uses', value: invite ? `${invite.uses}/${invite.maxUses === 0 ? '∞' : invite.maxUses}` : 'Unknown', inline: true },
                    { name: 'Member Count', value: guild.memberCount.toString(), inline: true }
                )
                .setThumbnail(user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ text: `User ID: ${user.id}` });

            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                await logChannel.send({ embeds: [embed] }).catch(err => {
                    console.error(`[InviteTracker] Failed to send join log:`, err);
                });
            }
        } catch (error) {
            console.error('[InviteTracker] Error sending join embed:', error);
        }
    }

    /**
     * Log invite data to database
     * @param {Object} data 
     */
    async logInviteToDatabase(data) {
        try {
            await pool.query(`
                INSERT INTO invite_log (
                    guild_id, user_id, utc_time, invite_code, invite_creator, 
                    creator_id, creator_name, channel_id, channel_name, 
                    max_uses, temporary, expires_at, uses_count
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                data.guildId, data.userId, data.utcTime, 
                data.inviteCode || data.invite, // backward compatibility
                data.inviteCreator, data.creatorId || data.inviteCreator, 
                data.creatorName || 'Unknown', data.channelId || 'Unknown', 
                data.channelName || 'Unknown', data.maxUses || 0, 
                data.temporary || false, data.expiresAt, data.usesCount || 0
            ]);
        } catch (error) {
            console.error('[InviteTracker] Database logging error:', error);
        }
    }

    /**
     * Handle guild member remove (for cleanup)
     * @param {import('discord.js').GuildMember} member 
     */
    async handleMemberLeave(member) {
        // Refresh invite cache in case invites were deleted
        await this.cacheGuildInvites(member.guild);
    }

    /**
     * Handle when bot joins a new guild
     * @param {import('discord.js').Guild} guild 
     */
    async handleGuildCreate(guild) {
        await this.cacheGuildInvites(guild);
    }
}

module.exports = new InviteTracker();
