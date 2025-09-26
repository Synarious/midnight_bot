const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { pool } = require('../../data/database.js');

module.exports = {
    name: 'invites-check',
    description: 'View comprehensive invite statistics and data from the database',
    usage: 'invites-check [filter] [user]',
    permissions: ['Administrator'],
    
    async execute(interaction) {
        try {
            // Check if user has administrator permissions
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '❌ You need Administrator permissions to use this command.',
                    ephemeral: true
                });
            }

            // Parse arguments for traditional command usage
            const args = interaction.commandArgs || [];
            const filter = args[0] || 'recent';
            let targetUser = null;
            
            // Parse user mention or ID if provided
            if (args[1]) {
                const userMatch = args[1].match(/^<@!?(\d+)>$/) || args[1].match(/^(\d+)$/);
                if (userMatch) {
                    try {
                        targetUser = await interaction.guild.members.fetch(userMatch[1]);
                        targetUser = targetUser.user;
                    } catch (error) {
                        return await interaction.reply({
                            content: '❌ Could not find the specified user.',
                            ephemeral: true
                        });
                    }
                }
            }

            const guildId = interaction.guild.id;

            await interaction.deferReply();

            let query, params, embedTitle, embedDescription;

            // Normalize filter input
            const normalizedFilter = filter.toLowerCase();
            
            if (normalizedFilter === 'recent' || normalizedFilter === 'r') {
                query = `
                    SELECT 
                        invite_code, creator_id, creator_name, channel_id, channel_name,
                        max_uses, temporary, expires_at, created_at, uses_count
                    FROM invite_log 
                    WHERE guild_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
                    ORDER BY created_at DESC 
                    LIMIT 20
                `;
                params = [guildId];
                embedTitle = '📊 Recent Invites (Last 7 Days)';
                embedDescription = 'Showing the 20 most recently created invites';
            } else if (normalizedFilter === 'active' || normalizedFilter === 'a') {
                query = `
                    SELECT 
                        invite_code, creator_id, creator_name, channel_id, channel_name,
                        max_uses, temporary, expires_at, created_at, uses_count
                    FROM invite_log 
                    WHERE guild_id = $1 
                    AND (expires_at IS NULL OR expires_at > NOW())
                    AND (max_uses = 0 OR uses_count < max_uses)
                    ORDER BY created_at DESC 
                    LIMIT 20
                `;
                params = [guildId];
                embedTitle = '✅ Active Invites';
                embedDescription = 'Showing invites that are currently valid and usable';
            } else if (normalizedFilter === 'popular' || normalizedFilter === 'p' || normalizedFilter === 'most') {
                query = `
                    SELECT 
                        invite_code, creator_id, creator_name, channel_id, channel_name,
                        max_uses, temporary, expires_at, created_at, uses_count
                    FROM invite_log 
                    WHERE guild_id = $1 AND uses_count > 0
                    ORDER BY uses_count DESC, created_at DESC 
                    LIMIT 15
                `;
                params = [guildId];
                embedTitle = '🔥 Most Used Invites';
                embedDescription = 'Showing invites ranked by usage count';
            } else if (normalizedFilter === 'user' || normalizedFilter === 'u') {
                if (!targetUser) {
                    return await interaction.editReply({
                        content: '❌ Please specify a user when using the "user" filter.\nUsage: `!invites-check user @user` or `!invites-check user 123456789`'
                    });
                }
                query = `
                    SELECT 
                        invite_code, creator_id, creator_name, channel_id, channel_name,
                        max_uses, temporary, expires_at, created_at, uses_count
                    FROM invite_log 
                    WHERE guild_id = $1 AND creator_id = $2
                    ORDER BY created_at DESC 
                    LIMIT 20
                `;
                params = [guildId, targetUser.id];
                embedTitle = `👤 Invites by ${targetUser.displayName}`;
                embedDescription = `Showing invites created by <@${targetUser.id}>`;
            } else {
                // Invalid filter, show help
                const helpEmbed = new EmbedBuilder()
                    .setColor('#ffa500')
                    .setTitle('📋 Invites-Check Command Help')
                    .setDescription('View comprehensive invite statistics and data from the database')
                    .addFields(
                        {
                            name: '📝 Usage',
                            value: '`!invites-check [filter] [user]`',
                            inline: false
                        },
                        {
                            name: '🔍 Available Filters',
                            value: [
                                '• `recent` or `r` - Last 7 days (default)',
                                '• `active` or `a` - Currently valid invites',
                                '• `popular` or `p` - Most used invites',
                                '• `user` or `u` - Invites by specific user'
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: '💡 Examples',
                            value: [
                                '`!invites-check` - Recent invites',
                                '`!invites-check active` - Active invites',
                                '`!invites-check user @someone` - User\'s invites',
                                '`!invites-check popular` - Most used invites'
                            ].join('\n'),
                            inline: false
                        }
                    )
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [helpEmbed] });
            }

            const result = await pool.query(query, params);
            const invites = result.rows;

            if (invites.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setTitle('📭 No Invites Found')
                    .setDescription('No invites match the specified criteria.')
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // Get summary statistics
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_invites,
                    COUNT(CASE WHEN expires_at IS NULL OR expires_at > NOW() THEN 1 END) as active_invites,
                    SUM(uses_count) as total_uses,
                    COUNT(DISTINCT creator_id) as unique_creators,
                    AVG(uses_count) as avg_uses_per_invite
                FROM invite_log 
                WHERE guild_id = $1
            `;
            const statsResult = await pool.query(statsQuery, [guildId]);
            const stats = statsResult.rows[0];

            const embed = new EmbedBuilder()
                .setColor('#00d4aa')
                .setTitle(embedTitle)
                .setDescription(embedDescription)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.displayName}` });

            // Add summary statistics
            embed.addFields({
                name: '📈 Server Statistics',
                value: [
                    `**Total Invites:** ${stats.total_invites}`,
                    `**Active Invites:** ${stats.active_invites}`,
                    `**Total Uses:** ${stats.total_uses || 0}`,
                    `**Unique Creators:** ${stats.unique_creators}`,
                    `**Avg Uses/Invite:** ${parseFloat(stats.avg_uses_per_invite || 0).toFixed(1)}`
                ].join('\n'),
                inline: true
            });

            // Format invite data into chunks
            const formatInvite = (invite) => {
                const channel = `<#${invite.channel_id}>`;
                const creator = `<@${invite.creator_id}>`;
                const uses = `${invite.uses_count}${invite.max_uses > 0 ? `/${invite.max_uses}` : ''}`;
                const expiry = invite.expires_at ? 
                    `<t:${Math.floor(new Date(invite.expires_at).getTime() / 1000)}:R>` : 
                    'Never';
                const created = `<t:${Math.floor(new Date(invite.created_at).getTime() / 1000)}:R>`;

                return [
                    `**Code:** \`${invite.invite_code}\``,
                    `**Creator:** ${creator}`,
                    `**Channel:** ${channel}`,
                    `**Uses:** ${uses}`,
                    `**Expires:** ${expiry}`,
                    `**Created:** ${created}`,
                    invite.temporary ? '🕒 Temporary' : '📌 Permanent'
                ].join('\n');
            };

            // Split invites into chunks for multiple fields (Discord has field limits)
            const maxInvitesPerField = 3;
            const inviteChunks = [];
            for (let i = 0; i < invites.length; i += maxInvitesPerField) {
                inviteChunks.push(invites.slice(i, i + maxInvitesPerField));
            }

            inviteChunks.forEach((chunk, index) => {
                const fieldValue = chunk.map(formatInvite).join('\n\n');
                embed.addFields({
                    name: index === 0 ? '📋 Invite Details' : `📋 Invite Details (${index + 1})`,
                    value: fieldValue.length > 1024 ? fieldValue.substring(0, 1021) + '...' : fieldValue,
                    inline: false
                });
            });

            // Add helpful footer note
            if (invites.length >= 20) {
                embed.setFooter({ 
                    text: `${interaction.user.displayName} • Showing first 20 results. Use filters to narrow down results.` 
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in invites-check command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff6b6b')
                .setTitle('❌ Database Error')
                .setDescription('An error occurred while fetching invite data from the database.')
                .setTimestamp();

            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },
};