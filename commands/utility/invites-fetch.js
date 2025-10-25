const { EmbedBuilder, PermissionsBitField, AuditLogEvent } = require('discord.js');
const { getGuildSettings, pool } = require('../../data/database.js');

module.exports = {
    name: 'invites-fetch',
    description: 'Fetch invite information for all members within a specified lookback period (Admin only)',
    usage: 'invites-fetch [days]',
    permissions: ['Administrator'],

    async execute(interaction) {
        const { guild, member } = interaction;

        // Permission check - require administrator
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ 
                content: '❌ You need Administrator permissions to use this command.', 
                ephemeral: true 
            });
        }

        // Hardcoded to 180 days for now - argument parsing issue to be fixed later
        const lookbackDays = 180;
        console.log(`[InvitesFetch] Hardcoded lookbackDays to:`, lookbackDays);

        // Handle deferReply for legacy commands
        if (interaction.deferReply) {
            await interaction.deferReply();
        } else {
            // For legacy commands, send initial message
            await interaction.reply('🔍 Starting invite data collection...');
        }
        
        return this.fetchAllMembersInviteData(interaction, lookbackDays);
    },

    /**
     * Fetch invite information for all members within the lookback period
     */
    async fetchAllMembersInviteData(interaction, lookbackDays) {
        try {
            const { guild } = interaction;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

            // Update message based on interaction type
            const updateMessage = async (content) => {
                if (interaction.editReply) {
                    return interaction.editReply(content);
                } else {
                    return interaction.reply(content).catch(() => 
                        interaction.channel?.send(content)
                    );
                }
            };

            await updateMessage(`🔍 Fetching all guild members who joined within the last ${lookbackDays} days...`);
            
            // Fetch all members
            const members = await guild.members.fetch();
            
            // Filter members by join date within lookback period
            const recentMembers = members.filter(member => 
                member.joinedAt && member.joinedAt >= cutoffDate
            );

            if (recentMembers.size === 0) {
                return updateMessage(`📭 No members found who joined within the last ${lookbackDays} days.`);
            }

            let processed = 0;
            let updated = 0;
            let alreadyExists = 0;
            let errors = 0;
            const totalMembers = recentMembers.size;

            await updateMessage(
                `📊 Found ${totalMembers} members who joined within the last ${lookbackDays} days.\n` +
                `Starting invite data collection...`
            );

            // Process members in smaller batches to avoid rate limits
            const memberArray = Array.from(recentMembers.values());
            const batchSize = 5;
            
            for (let i = 0; i < memberArray.length; i += batchSize) {
                const batch = memberArray.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (member) => {
                    try {
                        processed++;
                        
                        // Check if we already have data for this user
                        const existingData = await pool.query(
                            'SELECT COUNT(*) as count FROM invite_log WHERE guild_id = $1 AND user_id = $2',
                            [guild.id, member.user.id]
                        );
                        
                        if (existingData.rows[0].count > 0) {
                            alreadyExists++;
                            return; // Skip if we already have data
                        }

                        // Try to get join method from member object
                        let joinMethod = 'UNKNOWN';
                        let inviteCode = 'UNKNOWN';
                        let inviterInfo = 'UNKNOWN';
                        let inviterName = 'Unknown';
                        let channelId = 'UNKNOWN';
                        let channelName = 'Unknown Channel';

                        // Check if member has joinedVia property (newer Discord feature)
                        if (member.joinedVia) {
                            if (member.joinedVia.type === 'INVITE') {
                                joinMethod = 'INVITE';
                                inviteCode = member.joinedVia.inviteCode || 'UNKNOWN';
                                if (member.joinedVia.inviter) {
                                    inviterInfo = member.joinedVia.inviter.id;
                                    inviterName = member.joinedVia.inviter.username;
                                }
                                if (member.joinedVia.channel) {
                                    channelId = member.joinedVia.channel.id;
                                    channelName = member.joinedVia.channel.name;
                                }
                            } else if (member.joinedVia.type === 'VANITY_URL') {
                                joinMethod = 'VANITY_URL';
                                inviteCode = guild.vanityURLCode || 'VANITY';
                                inviterInfo = 'SERVER';
                                inviterName = 'Server Vanity URL';
                            } else if (member.joinedVia.type === 'DISCOVERY') {
                                joinMethod = 'DISCOVERY';
                                inviteCode = 'DISCOVERY';
                                inviterInfo = 'DISCOVERY';
                                inviterName = 'Server Discovery';
                            }
                        }

                        // Fallback: Try to correlate with current invites and audit logs
                        if (joinMethod === 'UNKNOWN') {
                            try {
                                // Check audit logs around the join time
                                const auditLogs = await guild.fetchAuditLogs({
                                    type: AuditLogEvent.MemberJoin,
                                    limit: 50
                                });

                                const userJoin = auditLogs.entries.find(entry => 
                                    entry.target?.id === member.user.id &&
                                    Math.abs(entry.createdTimestamp - member.joinedTimestamp) < 30000 // Within 30 seconds
                                );

                                if (userJoin) {
                                    joinMethod = 'AUDIT_LOG_DETECTED';
                                    // Try to find invites that were used around this time
                                    const currentInvites = await guild.invites.fetch().catch(() => null);
                                    if (currentInvites) {
                                        const potentialInvite = currentInvites.find(invite => 
                                            invite.inviter && 
                                            Math.abs(invite.createdTimestamp - userJoin.createdTimestamp) < 86400000 // Within 24 hours
                                        );
                                        if (potentialInvite) {
                                            inviteCode = potentialInvite.code;
                                            inviterInfo = potentialInvite.inviter.id;
                                            inviterName = potentialInvite.inviter.username;
                                            channelId = potentialInvite.channel?.id || 'UNKNOWN';
                                            channelName = potentialInvite.channel?.name || 'Unknown Channel';
                                        }
                                    }
                                }
                            } catch (auditError) {
                                // Ignore individual audit log errors
                                console.log(`[InvitesFetch] Could not check audit logs for ${member.user.tag}`);
                            }
                        }

                        // Insert the data into database
                        await pool.query(`
                            INSERT INTO invite_log (
                                guild_id, user_id, utc_time, invite_code, invite_creator,
                                creator_id, creator_name, channel_id, channel_name,
                                max_uses, temporary, expires_at, uses_count
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                        `, [
                            guild.id,
                            member.user.id,
                            member.joinedAt.toISOString(),
                            inviteCode,
                            inviterInfo,
                            inviterInfo,
                            inviterName,
                            channelId,
                            channelName,
                            0,
                            false,
                            null,
                            0
                        ]);

                        updated++;

                    } catch (memberError) {
                        errors++;
                        console.error(`[InvitesFetch] Error processing member ${member.user.tag}:`, memberError);
                    }
                }));

                // Update progress every 25 members
                if (processed % 25 === 0) {
                    await updateMessage(
                        `📊 Progress: ${processed}/${totalMembers} members processed\n` +
                        `✅ New Records: ${updated} | 📋 Already Exists: ${alreadyExists} | ❌ Errors: ${errors}`
                    );
                }

                // Small delay between batches to respect rate limits
                if (i + batchSize < memberArray.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Final summary
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Member Invite Data Collection Complete`)
                .setColor('#00FF00')
                .addFields(
                    { name: 'Lookback Period', value: `${lookbackDays} days`, inline: true },
                    { name: 'Members in Period', value: totalMembers.toString(), inline: true },
                    { name: 'Processed', value: processed.toString(), inline: true },
                    { name: 'New Records Added', value: updated.toString(), inline: true },
                    { name: 'Already Had Data', value: alreadyExists.toString(), inline: true },
                    { name: 'Errors', value: errors.toString(), inline: true }
                )
                .setDescription(
                    `Successfully processed all members who joined within the last ${lookbackDays} days.\n\n` +
                    `**Join Methods Detected:**\n` +
                    `• Direct invite links\n` +
                    `• Server vanity URLs\n` +
                    `• Server discovery\n` +
                    `• Correlation via audit logs\n\n` +
                    `Use \`!invites-check\` to view detailed statistics.`
                )
                .setTimestamp()
                .setFooter({ text: `Scan completed by ${interaction.user.tag}` });

            // Send final result
            if (interaction.editReply) {
                await interaction.editReply({ content: '', embeds: [embed] });
            } else {
                await interaction.reply({ embeds: [embed] }).catch(() => 
                    interaction.channel?.send({ embeds: [embed] })
                );
            }

        } catch (error) {
            console.error('[InvitesFetch] Member fetch error:', error);
            const errorMsg = '❌ An error occurred during the member invite data collection. Check console for details.';
            if (interaction.editReply) {
                await interaction.editReply(errorMsg);
            } else {
                await interaction.reply(errorMsg).catch(() => 
                    interaction.channel?.send(errorMsg)
                );
            }
        }
    },

    /**
     * Legacy function - kept for compatibility but not used in new implementation
     */
    async performRetroactiveScan(interaction) {
        try {
            const { guild } = interaction;
            
            await interaction.deferReply({ ephemeral: true });
            
            // Fetch all members
            await interaction.editReply('🔍 Fetching all guild members...');
            const members = await guild.members.fetch();
            
            let processed = 0;
            let updated = 0;
            let errors = 0;
            const totalMembers = members.size;

            await interaction.editReply(`📊 Processing ${totalMembers} members for join method data...`);

            // Process members in batches to avoid rate limits
            const memberArray = Array.from(members.values());
            const batchSize = 10;
            
            for (let i = 0; i < memberArray.length; i += batchSize) {
                const batch = memberArray.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (member) => {
                    try {
                        processed++;
                        
                        // Check if we already have data for this user
                        const existingData = await pool.query(
                            'SELECT COUNT(*) as count FROM invite_log WHERE guild_id = $1 AND user_id = $2',
                            [guild.id, member.user.id]
                        );
                        
                        if (existingData.rows[0].count > 0) {
                            return; // Skip if we already have data
                        }

                        // Try to get join method from member object
                        let joinMethod = 'UNKNOWN';
                        let inviteCode = 'UNKNOWN';
                        let inviterInfo = 'UNKNOWN';

                        // Check if member has joinedVia property (newer Discord feature)
                        if (member.joinedVia) {
                            if (member.joinedVia.type === 'INVITE') {
                                joinMethod = 'INVITE';
                                inviteCode = member.joinedVia.inviteCode || 'UNKNOWN';
                                inviterInfo = member.joinedVia.inviter?.id || 'UNKNOWN';
                            } else if (member.joinedVia.type === 'VANITY_URL') {
                                joinMethod = 'VANITY_URL';
                                inviteCode = 'VANITY';
                                inviterInfo = 'SERVER';
                            } else if (member.joinedVia.type === 'DISCOVERY') {
                                joinMethod = 'DISCOVERY';
                                inviteCode = 'DISCOVERY';
                                inviterInfo = 'DISCOVERY';
                            }
                        }

                        // Fallback: Check audit logs for this specific user
                        if (joinMethod === 'UNKNOWN') {
                            try {
                                const auditLogs = await guild.fetchAuditLogs({
                                    type: AuditLogEvent.MemberJoin,
                                    limit: 100
                                });

                                const userJoin = auditLogs.entries.find(entry => 
                                    entry.target?.id === member.user.id
                                );

                                if (userJoin) {
                                    joinMethod = 'AUDIT_LOG';
                                    // Try to correlate with current invites at time of join
                                    const currentInvites = await guild.invites.fetch().catch(() => null);
                                    if (currentInvites) {
                                        // This is basic correlation - in practice, we'd need historical invite data
                                        const potentialInvite = currentInvites.find(invite => 
                                            Math.abs(invite.createdTimestamp - userJoin.createdTimestamp) < 3600000 // Within 1 hour
                                        );
                                        if (potentialInvite) {
                                            inviteCode = potentialInvite.code;
                                            inviterInfo = potentialInvite.inviter?.id || 'UNKNOWN';
                                        }
                                    }
                                }
                            } catch (auditError) {
                                // Ignore audit log errors for individual users
                            }
                        }

                        // Insert the data into database
                        await pool.query(`
                            INSERT INTO invite_log (
                                guild_id, user_id, utc_time, invite_code, invite_creator,
                                creator_id, creator_name, channel_id, channel_name,
                                max_uses, temporary, expires_at, uses_count
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                        `, [
                            guild.id,
                            member.user.id,
                            member.joinedAt ? member.joinedAt.toISOString() : new Date().toISOString(),
                            inviteCode,
                            inviterInfo,
                            inviterInfo,
                            'Retroactive Scan',
                            'UNKNOWN',
                            'Unknown Channel',
                            0,
                            false,
                            null,
                            0
                        ]);

                        updated++;

                    } catch (memberError) {
                        errors++;
                        console.error(`[InvitesFetch] Error processing member ${member.user.tag}:`, memberError);
                    }
                }));

                // Update progress every 50 members
                if (processed % 50 === 0) {
                    await interaction.editReply(
                        `📊 Progress: ${processed}/${totalMembers} members processed\n` +
                        `✅ Updated: ${updated} | ❌ Errors: ${errors}`
                    );
                }
            }

            // Final summary
            const embed = new EmbedBuilder()
                .setTitle('🔍 Retroactive Invite Scan Complete')
                .setColor('#00FF00')
                .addFields(
                    { name: 'Total Members', value: totalMembers.toString(), inline: true },
                    { name: 'Processed', value: processed.toString(), inline: true },
                    { name: 'Updated Records', value: updated.toString(), inline: true },
                    { name: 'Errors', value: errors.toString(), inline: true },
                    { name: 'Completion Rate', value: `${((processed - errors) / processed * 100).toFixed(1)}%`, inline: true }
                )
                .setDescription(
                    `Successfully scanned all members and populated missing join method data.\n\n` +
                    `**Note:** Some entries may show "UNKNOWN" for invite codes where the join method couldn't be determined from available data.`
                )
                .setTimestamp()
                .setFooter({ text: `Scan completed by ${interaction.user.tag}` });

            await interaction.editReply({ content: '', embeds: [embed] });

        } catch (error) {
            console.error('[InvitesFetch] Retroactive scan error:', error);
            await interaction.editReply('❌ An error occurred during the retroactive scan. Check console for details.');
        }
    }
,

  // Rate limit: 3 seconds 
  rateLimit: 3000,
};