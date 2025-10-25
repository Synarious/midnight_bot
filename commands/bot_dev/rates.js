const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const rateLimiter = require('../../utils/rateLimiter.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rates')
        .setDescription('[Owner Only] View rate limit statistics'),

    async execute(interaction) {
        // Owner-only check
        const ownerId = process.env.BOT_OWNER_ID || process.env.OWNER_ID;
        if (!ownerId) {
            return interaction.reply({ 
                content: '⚠️ BOT_OWNER_ID is not configured in environment variables.\n\nTo use this command, add your Discord user ID to the `.env` file:\n```\nBOT_OWNER_ID=your_discord_id_here\n```\nYou can get your ID by right-clicking your username in Discord (Developer Mode must be enabled).', 
                ephemeral: true 
            });
        }

        if (interaction.user.id !== ownerId) {
            return interaction.reply({ 
                content: '❌ This command is only available to the bot owner.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        try {
            // Get statistics for different time windows
            const windows = {
                '1 Minute': 60 * 1000,
                '5 Minutes': 5 * 60 * 1000,
                '30 Minutes': 30 * 60 * 1000,
                '24 Hours': 24 * 60 * 60 * 1000,
                '7 Days': 7 * 24 * 60 * 60 * 1000
            };

            // Small helper utilities to keep embeds within Discord limits and avoid throws
            const MAX_EMBED_FIELDS = 25;
            const MAX_FIELD_NAME = 256;
            const MAX_FIELD_VALUE = 1024;

            const truncate = (s, n) => {
                if (s === null || s === undefined) return '';
                s = String(s);
                if (s.length <= n) return s;
                return `${s.slice(0, n - 1)}…`;
            };

            const formatTopIdentifiers = (topIdentifiers, maxParts = 10) => {
                if (!Array.isArray(topIdentifiers) || topIdentifiers.length === 0) return '';
                const parts = topIdentifiers.map(([id, count]) => `\`${id}\` (${count})`);
                if (parts.length <= maxParts) return parts.join(', ');
                const shown = parts.slice(0, maxParts).join(', ');
                const remaining = parts.length - maxParts;
                return `${shown} and ${remaining} more`;
            };

            const safeAddFields = (embed, fields) => {
                // Use embed.data.fields to determine how many fields already exist
                const current = (embed?.data?.fields && embed.data.fields.length) ? embed.data.fields.length : 0;
                let allowed = MAX_EMBED_FIELDS - current;
                if (allowed <= 0) {
                    console.warn('[rates] No remaining embed fields available; skipping extra fields');
                    return;
                }

                // Sanitize/truncate fields
                const sanitized = fields.map(f => ({
                    name: truncate(f.name || '', MAX_FIELD_NAME),
                    value: truncate(f.value || '', MAX_FIELD_VALUE),
                    inline: !!f.inline
                }));

                if (sanitized.length <= allowed) {
                    embed.addFields(sanitized);
                    return;
                }

                // If we don't have space for everything, leave room for a summary field
                const leaveSummarySlot = Math.max(0, Math.min(1, allowed));
                const toAddCount = Math.max(0, allowed - leaveSummarySlot);
                if (toAddCount > 0) embed.addFields(sanitized.slice(0, toAddCount));

                const omitted = sanitized.length - toAddCount;
                if (omitted > 0 && leaveSummarySlot > 0) {
                    embed.addFields({ name: '…and more', value: `${omitted} additional item(s) omitted to fit embed limits.`, inline: false });
                }
            };

            const embed = new EmbedBuilder()
                .setTitle('⏱️ Rate Limit Statistics')
                .setColor(0x3498db)
                .setTimestamp()
                .setFooter({ text: 'Rate limit tracking is in-memory and resets on bot restart' });

            // Gather window stats first so we can also produce a text fallback if needed
            const windowsStats = {};
            const windowFields = [];
            for (const [windowName, windowMs] of Object.entries(windows)) {
                const stats = rateLimiter.getRateLimitStats(windowMs);
                windowsStats[windowName] = stats;

                let fieldValue = `**Total Hits:** ${stats.total}\n`;
                fieldValue += `**Unique Users:** ${stats.uniqueUsers}`;

                if (stats.total > 0 && Array.isArray(stats.topIdentifiers) && stats.topIdentifiers.length > 0) {
                    fieldValue += `\n**Top Commands:** ${formatTopIdentifiers(stats.topIdentifiers, 8)}`;
                }

                windowFields.push({ name: `📊 ${windowName}`, value: fieldValue || 'No rate limit hits', inline: false });
            }

            // Add window fields safely
            safeAddFields(embed, windowFields);

            // Show active cooldown counts per command where possible
            const knownCommands = {};
            // Iterate collection using entries() to keep clarity
            for (const [name, cmd] of interaction.client.slashCommands) {
                if (cmd && cmd.data && cmd.data.name && cmd.rateLimit) {
                    // Store numeric values where possible
                    knownCommands[cmd.data.name] = Number(cmd.rateLimit) || cmd.rateLimit;
                }
            }

            const activeCounts = rateLimiter.getActiveCooldownCounts(knownCommands);
            if (Object.keys(activeCounts).length > 0) {
                const activeHeader = [{ name: 'Active cooldowns', value: '\u200b', inline: false }];
                safeAddFields(embed, activeHeader);

                const activeEntries = Object.entries(activeCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, count]) => ({ name: `⏳ ${truncate(id, 220)}`, value: `${count} user(s) on cooldown`, inline: true }));

                safeAddFields(embed, activeEntries);
            }

            // Add current active users being tracked
            const activeUsersCount = rateLimiter.getActiveUserCount();
            const totalHits = rateLimiter.getTotalHitsTracked();
            embed.setDescription(`Currently tracking rate limits for **${activeUsersCount}** active users\nTotal hits tracked: **${totalHits}**`);

            console.log('[rates] Embed created successfully, sending reply...');

            // Try to send the embed; if it fails (validation or size) fall back to plaintext summary
            try {
                await interaction.editReply({ embeds: [embed] });
                console.log('[rates] Reply sent successfully');
            } catch (sendErr) {
                console.warn('[rates] Failed to send embed, falling back to plaintext summary:', sendErr && sendErr.message);

                // Build a compact plaintext summary
                const lines = [];
                for (const [windowName, stats] of Object.entries(windowsStats)) {
                    const top = (Array.isArray(stats.topIdentifiers) && stats.topIdentifiers.length > 0) ? formatTopIdentifiers(stats.topIdentifiers, 6) : '—';
                    lines.push(`${windowName}: ${stats.total} hits, ${stats.uniqueUsers} users. Top: ${top}`);
                }
                const activeSummary = Object.entries(activeCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([id, count]) => `${id} (${count})`)
                    .join(', ') || 'None';

                const fallbackText = `Rate limit statistics:\n\n${lines.join('\n')}\n\nActive cooldowns: ${activeSummary}\n\nCurrently tracking ${activeUsersCount} active users — ${totalHits} total hits tracked.`;

                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: fallbackText, embeds: [] });
                    } else {
                        await interaction.reply({ content: fallbackText, ephemeral: true });
                    }
                } catch (replyErr) {
                    console.error('[rates] Failed to send fallback reply:', replyErr);
                    throw replyErr; // Let outer catch handle generic error messaging
                }
            }

        } catch (error) {
            console.error('Error in rates command:', error);
            console.error('Error stack:', error.stack);
            
            const errorContent = 'An error occurred while retrieving rate limit statistics.';
            
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorContent, embeds: [] });
                } else {
                    await interaction.reply({ content: errorContent, ephemeral: true });
                }
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
            }
        }
    }
,

  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
