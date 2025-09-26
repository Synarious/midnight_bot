const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, AuditLogEvent } = require('discord.js');
const { getGuildSettings, pool } = require('../../data/database.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invites-fetch')
        .setDescription('Fetch invite information from audit logs or database for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check invite information for')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option.setName('audit_logs')
                .setDescription('Check audit logs instead of database')
                .setRequired(false)
        ),

    async execute(interaction) {
        const { guild, member } = interaction;
        const targetUser = interaction.options.getUser('user');
        const useAuditLogs = interaction.options.getBoolean('audit_logs') || false;

        // Permission check - require administrator
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ 
                content: 'You need Administrator permissions to use this command.', 
                ephemeral: true 
            });
        }

        // Bot permission check
        if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
            return interaction.reply({ 
                content: 'I need View Audit Log permission to fetch invite information.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            if (useAuditLogs) {
                await this.fetchFromAuditLogs(interaction, targetUser);
            } else {
                await this.fetchFromDatabase(interaction, targetUser);
            }
        } catch (error) {
            console.error('[InvitesFetch] Error:', error);
            await interaction.editReply('An error occurred while fetching invite information.');
        }
    },

    /**
     * Fetch invite info from database
     */
    async fetchFromDatabase(interaction, targetUser) {
        try {
            const result = await pool.query(`
                SELECT * FROM invite_log 
                WHERE guild_id = $1 AND user_id = $2 
                ORDER BY utc_time DESC 
                LIMIT 10
            `, [interaction.guild.id, targetUser.id]);

            if (result.rows.length === 0) {
                return interaction.editReply(`No invite records found for ${targetUser.tag} in the database.`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 Invite History - ${targetUser.tag}`)
                .setColor('#0099FF')
                .setThumbnail(targetUser.displayAvatarURL())
                .setFooter({ text: `Total records: ${result.rows.length}` })
                .setTimestamp();

            let description = '';
            for (const [index, record] of result.rows.entries()) {
                const timestamp = new Date(record.utc_time);
                const inviteCreator = record.invite_creator === 'UNKNOWN' ? 'Unknown' : `<@${record.invite_creator}>`;
                
                description += `**${index + 1}.** \`${record.invite}\` by ${inviteCreator}\n`;
                description += `   📅 <t:${Math.floor(timestamp.getTime() / 1000)}:F>\n\n`;

                // Discord embed description limit
                if (description.length > 3500) {
                    description += '*(More records available...)*';
                    break;
                }
            }

            embed.setDescription(description || 'No valid records found.');

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[InvitesFetch] Database fetch error:', error);
            await interaction.editReply('Failed to fetch data from database.');
        }
    },

    /**
     * Fetch invite info from audit logs
     */
    async fetchFromAuditLogs(interaction, targetUser) {
        try {
            const auditLogs = await interaction.guild.fetchAuditLogs({
                type: AuditLogEvent.MemberJoin,
                limit: 100
            });

            // Find all join entries for this user
            const userJoins = auditLogs.entries.filter(entry => entry.target?.id === targetUser.id);

            if (userJoins.size === 0) {
                return interaction.editReply(`No join records found for ${targetUser.tag} in audit logs.`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`🔍 Audit Log Joins - ${targetUser.tag}`)
                .setColor('#FF9900')
                .setThumbnail(targetUser.displayAvatarURL())
                .setFooter({ text: `Found ${userJoins.size} join record(s)` })
                .setTimestamp();

            let description = '';
            let count = 1;

            for (const entry of userJoins.values()) {
                const timestamp = entry.createdTimestamp;
                
                description += `**${count}.** Join detected\n`;
                description += `   📅 <t:${Math.floor(timestamp / 1000)}:F>\n`;
                description += `   🆔 Entry ID: ${entry.id}\n\n`;

                count++;

                if (description.length > 3500) {
                    description += '*(More records available...)*';
                    break;
                }
            }

            embed.setDescription(description);

            // Try to correlate with current invites
            try {
                const currentInvites = await interaction.guild.invites.fetch();
                if (currentInvites.size > 0) {
                    let inviteInfo = '**Current Server Invites:**\n';
                    let inviteCount = 0;
                    
                    for (const invite of currentInvites.values()) {
                        if (inviteCount >= 5) {
                            inviteInfo += '*(More invites available...)*\n';
                            break;
                        }
                        
                        inviteInfo += `\`${invite.code}\` by ${invite.inviter?.tag || 'Unknown'} (${invite.uses} uses)\n`;
                        inviteCount++;
                    }
                    
                    embed.addFields({ name: 'Server Invites', value: inviteInfo, inline: false });
                }
            } catch (inviteError) {
                console.error('[InvitesFetch] Could not fetch current invites:', inviteError);
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[InvitesFetch] Audit log fetch error:', error);
            await interaction.editReply('Failed to fetch audit logs. Make sure I have proper permissions.');
        }
    }
};