const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { pool, getGuildSettings, getUserPermissionLevel } = require('../../data/database.js');

/**
 * Comprehensive User Information Command (whois)
 * 
 * Features:
 * - Basic Discord user information (account creation, join date, roles, etc.)
 * - Invite tracking integration (how they joined, invites they've created)
 * - Moderation history (mutes, bans, kicks, warnings, timeouts)
 * - AI moderation data (filtered messages, safety scores)
 * - Permission level display
 * - Rate limiting and security checks
 * 
 * Requirements:
 * - Helper permissions or higher to use
 * - Cannot be used on bots unless requester is Administrator
 * - 5-second cooldown for non-administrators
 * 
 * Database Integration:
 * - invite_log: Tracks invite usage and creation
 * - muted_users: Shows mute history and active mutes
 * - filtered_messages: AI moderation flagged content
 * - user_info: General user statistics and safety scores
 * - guild_settings: Permission level checking
 */

// Rate limiting map for whois command
const rateLimits = new Map();

const debug = (...args) => console.debug('[whois]', ...args);

async function ensureUserInstance(client, candidate) {
  if (!candidate) return null;

  const isFullUser = candidate.username && typeof candidate.displayAvatarURL === 'function';
  if (isFullUser) return candidate;

  if (!candidate.id) return null;

  try {
    const fetched = await client.users.fetch(candidate.id);
    debug('Hydrated user from ID', candidate.id);
    return fetched ?? null;
  } catch (fetchError) {
    console.warn('[whois] Failed to hydrate user from ID:', candidate.id, fetchError);
    return null;
  }
}

module.exports = {
  name: 'whois',
  description: 'Display comprehensive information about a user',
  usage: 'whois <user>',
  permissions: ['Helper'],
  cooldown: 5, // 5 second cooldown
  
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Display comprehensive information about a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to get information about')
        .setRequired(true)
    ),

  async execute(interaction, legacyArgs = undefined) {
    const { guild, member: requester } = interaction;
    debug('execute invoked', {
      guildId: guild?.id,
      requesterId: requester?.id,
      legacyArgsLength: Array.isArray(legacyArgs) ? legacyArgs.length : null,
      hasCommandArgsProp: Array.isArray(interaction.commandArgs),
      hasOptions: Boolean(interaction.options)
    });
    
    // Rate limiting check (unless admin)
    if (!requester.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const userId = requester.id;
      const now = Date.now();
      const cooldown = 5000; // 5 seconds
      
      if (rateLimits.has(userId)) {
        const expirationTime = rateLimits.get(userId) + cooldown;
        
        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          return interaction.reply({
            content: `❌ Please wait ${timeLeft.toFixed(1)} more seconds before using whois again.`,
            ephemeral: true
          });
        }
      }
      
      rateLimits.set(userId, now);
      // Clean up old entries (prevent memory leak)
      setTimeout(() => rateLimits.delete(userId), cooldown);
    }
    
    // Get target user
    let targetUser;
    const fallbackArgs = Array.isArray(interaction.commandArgs) ? interaction.commandArgs : undefined;
    const argsSource = Array.isArray(legacyArgs) ? legacyArgs : fallbackArgs;
    const isLegacyInvocation = Array.isArray(argsSource);
    debug('Invocation mode', isLegacyInvocation ? 'legacy' : 'slash');

    if (!isLegacyInvocation && interaction.options?.getUser) {
      // Slash command invocation
      targetUser = interaction.options.getUser('user');
      debug('Slash option provided for user', targetUser?.id ?? null);
    } else {
      // Legacy command invocation (prefix adapter)
      const args = (argsSource || []).map(part => String(part).trim()).filter(Boolean);
      debug('Legacy args', args);

      if (args.length === 0) {
        return interaction.reply({
          content: '❌ Please specify a user to get information about.',
          ephemeral: true
        });
      }

      // Parse user from mention, ID, or username
      const userInput = args[0];
      const userIdMatch = userInput.match(/^(?:<@!?)?(\d{17,20})>?$/);

      if (userIdMatch) {
        try {
          targetUser = await interaction.client.users.fetch(userIdMatch[1]);
          debug('Resolved user via mention/ID', targetUser?.id ?? null);
        } catch (error) {
          console.warn('[whois] Failed to fetch user from mention/ID:', error);
        }
      }

      if (!targetUser) {
        // Try to find by username in guild cache
        const lowered = userInput.toLowerCase();
        const member = guild.members.cache.find(m =>
          m.user.username.toLowerCase() === lowered ||
          (m.displayName && m.displayName.toLowerCase() === lowered)
        );

        if (member) {
          targetUser = member.user;
          debug('Resolved user via guild cache', targetUser?.id ?? null);
        } else {
          return interaction.reply({
            content: '❌ User not found. Please use @mention, user ID, or exact username.',
            ephemeral: true
          });
        }
      }
    }

    targetUser = await ensureUserInstance(interaction.client, targetUser);
    debug('Post hydration target user', targetUser?.id ?? null);

    if (!targetUser) {
      return interaction.reply({
        content: '❌ User not found. Please use @mention, user ID, or exact username.',
        ephemeral: true
      });
    }

    // Permission check
    const settings = await getGuildSettings(guild.id);
    if (!settings) {
      return interaction.reply({ 
        content: '❌ Guild settings not found. Please run `/setup` first.', 
        ephemeral: true 
      });
    }

    // Check if requester has helper permissions or higher
    const hasPermission = requester.permissions.has(PermissionsBitField.Flags.Administrator) ||
      requester.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
      await getUserPermissionLevel(guild.id, requester.id, requester.roles.cache) !== null;

    if (!hasPermission) {
      return interaction.reply({ 
        content: '❌ You need Helper permissions, Moderate Members permission, or Administrator permission to use this command.', 
        ephemeral: true 
      });
    }

    // Don't allow looking up bot owners or other bots (unless requester is admin)
    if (targetUser.bot && !requester.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ 
        content: '❌ You cannot use whois on bots unless you have Administrator permission.', 
        ephemeral: true 
      });
    }

    // Fetch target member if they're in the guild
    let targetMember;
    try {
      targetMember = await guild.members.fetch(targetUser.id);
    } catch (error) {
      // User not in guild, that's okay
    }

    try {
      // Gather all user information
      const userInfo = await this.gatherUserInfo(guild.id, targetUser.id, targetUser, targetMember);
      
      // Create embeds (might be multiple due to Discord's field limits)
      const embeds = await this.createUserInfoEmbeds(userInfo, targetUser, targetMember, guild);
      
      // Send response
      if (interaction.reply && !interaction.replied) {
        await interaction.reply({ embeds });
      } else if (interaction.editReply) {
        await interaction.editReply({ embeds });
      } else {
        await interaction.channel?.send({ embeds });
      }

    } catch (error) {
      console.error(`[❌ COMMAND FAILED] whois:`, error);
      const errorMsg = '❌ An error occurred while gathering user information.';
      
      if (interaction.reply && !interaction.replied) {
        await interaction.reply({ content: errorMsg, ephemeral: true });
      } else {
        await interaction.channel?.send(errorMsg);
      }
    }
  },

  /**
   * Gather comprehensive user information from database
   */
  async gatherUserInfo(guildId, userId, user, member) {
    const info = {
      user,
      member,
      inviteData: null,
      moderationHistory: null,
      aiModerationData: null,
      userStats: null,
      activeMute: null,
      permissionLevel: null
    };

    try {
      // Get invite information - how they joined and invites they created
      const inviteQuery = `
        SELECT 
          il1.invite_code,
          il1.creator_name,
          il1.creator_id,
          il1.channel_name,
          il1.utc_time as join_time,
          COUNT(il2.log_id) as invites_created
        FROM invite_log il1
        LEFT JOIN invite_log il2 ON il2.guild_id = $1 AND il2.creator_id = $2 AND il2.user_id IS NOT NULL
        WHERE il1.guild_id = $1 AND il1.user_id = $2
        GROUP BY il1.invite_code, il1.creator_name, il1.creator_id, il1.channel_name, il1.utc_time
        ORDER BY il1.utc_time DESC
        LIMIT 1
      `;
      const inviteResult = await pool.query(inviteQuery, [guildId, userId]);
      
      // Get total invites created by this user and recent activity
      const inviteCreatedQuery = `
        SELECT 
          COUNT(*) as total_invites_created,
          COUNT(*) FILTER (WHERE utc_time > NOW() - INTERVAL '30 days') as invites_last_30_days,
          MAX(utc_time) as last_invite_created
        FROM invite_log 
        WHERE guild_id = $1 AND creator_id = $2 AND user_id IS NOT NULL
      `;
      const inviteCreatedResult = await pool.query(inviteCreatedQuery, [guildId, userId]);

      const inviteStats = inviteCreatedResult.rows[0] || {};
      
      if (inviteResult.rows[0]) {
        info.inviteData = {
          ...inviteResult.rows[0],
          total_invites_created: parseInt(inviteStats.total_invites_created || 0),
          invites_last_30_days: parseInt(inviteStats.invites_last_30_days || 0),
          last_invite_created: inviteStats.last_invite_created
        };
      } else {
        info.inviteData = {
          total_invites_created: parseInt(inviteStats.total_invites_created || 0),
          invites_last_30_days: parseInt(inviteStats.invites_last_30_days || 0),
          last_invite_created: inviteStats.last_invite_created
        };
      }

      // Get moderation history
      const moderationQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE active = false) as past_mutes,
          COUNT(*) FILTER (WHERE active = true) as active_mutes
        FROM muted_users 
        WHERE guild_id = $1 AND user_id = $2
      `;
      const moderationResult = await pool.query(moderationQuery, [guildId, userId]);
      info.moderationHistory = moderationResult.rows[0] || { past_mutes: 0, active_mutes: 0 };

      // Get active mute details
      const activeMuteQuery = `
        SELECT reason, actioned_by, length, expires, timestamp
        FROM muted_users 
        WHERE guild_id = $1 AND user_id = $2 AND active = true
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      const activeMuteResult = await pool.query(activeMuteQuery, [guildId, userId]);
      info.activeMute = activeMuteResult.rows[0] || null;

      // Get AI moderation data
      const aiModerationQuery = `
        SELECT 
          COUNT(*) as total_filtered_messages,
          SUM(hate) as total_hate,
          SUM(harassment) as total_harassment,
          SUM(self_harm) as total_self_harm,
          SUM(sexual) as total_sexual,
          SUM(violence) as total_violence,
          MAX(timestamp) as last_filtered
        FROM filtered_messages 
        WHERE guild_id = $1 AND user_id = $2
      `;
      const aiModerationResult = await pool.query(aiModerationQuery, [guildId, userId]);
      info.aiModerationData = aiModerationResult.rows[0] || null;

      // Get user stats from user_info table
      const userStatsQuery = `
        SELECT 
          messages,
          ai_hate, ai_harassment, ai_self_harm, ai_sexual, ai_violence,
          safety_hate, safety_sexual, safety_topicsPolitical, safety_topicsUncomfortable,
          banned, kicked, warned, muted, timeout,
          ignore,
          timestamp
        FROM user_info 
        WHERE guild_id = $1 AND user_id = $2
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      const userStatsResult = await pool.query(userStatsQuery, [guildId, userId]);
      info.userStats = userStatsResult.rows[0] || null;

      // Get permission level if member exists
      if (member) {
        info.permissionLevel = await getUserPermissionLevel(guildId, userId, member.roles.cache);
      }

    } catch (error) {
      console.error('[whois] Error gathering user info:', error);
    }

    return info;
  },

  /**
   * Create user information embeds
   */
  async createUserInfoEmbeds(userInfo, user, member, guild) {
    const embeds = [];
    
    // Main embed with basic user information
    const mainEmbed = new EmbedBuilder()
      .setTitle('👤 User Information')
      .setColor(member ? member.displayHexColor || '#0099FF' : '#0099FF')
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTimestamp()
      .setFooter({ text: `User ID: ${user.id}` });

    // Basic user info
    mainEmbed.addFields(
      { 
        name: '📋 Basic Info', 
        value: [
          `**Username:** ${user.tag}`,
          `**Display Name:** ${member?.displayName || user.displayName || user.username}`,
          `**User ID:** ${user.id}`,
          `**Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:F>`,
          `**Account Age:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`
        ].join('\n'),
        inline: false 
      }
    );

    // Guild-specific info if member exists
    if (member) {
      const roles = member.roles.cache
        .filter(role => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map(role => `<@&${role.id}>`)
        .slice(0, 10); // Limit to prevent embed overflow

      mainEmbed.addFields(
        { 
          name: '🏠 Guild Info', 
          value: [
            `**Joined Guild:** <t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,
            `**Join Age:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
            `**Nickname:** ${member.nickname || 'None'}`,
            `**Highest Role:** ${member.roles.highest.name}`,
            `**Role Count:** ${member.roles.cache.size - 1}`, // -1 for @everyone
            `**Boosting:** ${member.premiumSince ? `Since <t:${Math.floor(member.premiumSince.getTime() / 1000)}:R>` : 'No'}`
          ].join('\n'),
          inline: false 
        }
      );

      if (roles.length > 0) {
        mainEmbed.addFields({
          name: `🎭 Roles (${member.roles.cache.size - 1})`,
          value: roles.join(' ') + (member.roles.cache.size > 11 ? `\n*+${member.roles.cache.size - 11} more...*` : ''),
          inline: false
        });
      }

      // Permission level
      if (userInfo.permissionLevel) {
        const permissionNames = {
          'super_admin': '👑 Super Admin',
          'admin': '🛡️ Admin', 
          'mod': '🔨 Moderator',
          'jr_mod': '🔧 Jr Moderator',
          'helper': '🤝 Helper'
        };
        mainEmbed.addFields({
          name: '🔐 Permission Level',
          value: permissionNames[userInfo.permissionLevel] || userInfo.permissionLevel,
          inline: true
        });
      }
    } else {
      mainEmbed.addFields({
        name: '🏠 Guild Status',
        value: '❌ **Not in this guild**',
        inline: false
      });
    }

    embeds.push(mainEmbed);

    // Invite tracking embed
    if (userInfo.inviteData) {
      const inviteEmbed = new EmbedBuilder()
        .setTitle('🔗 Invite Information')
        .setColor('#00FF7F')
        .setTimestamp();

      const inviteFields = [];

      if (userInfo.inviteData.invite_code) {
        inviteFields.push([
          `**How they joined:**`,
          `• Invite Code: \`${userInfo.inviteData.invite_code}\``,
          `• Invited by: ${userInfo.inviteData.creator_name} (<@${userInfo.inviteData.creator_id}>)`,
          `• Channel: #${userInfo.inviteData.channel_name}`,
          `• Join Time: <t:${Math.floor(new Date(userInfo.inviteData.join_time).getTime() / 1000)}:F>`
        ].join('\n'));
      }

      const inviteStats = [
        `**Total Invites Created:** ${userInfo.inviteData.total_invites_created}`,
        `**Invites (Last 30 Days):** ${userInfo.inviteData.invites_last_30_days}`
      ];
      
      if (userInfo.inviteData.last_invite_created) {
        inviteStats.push(`**Last Invite Created:** <t:${Math.floor(new Date(userInfo.inviteData.last_invite_created).getTime() / 1000)}:R>`);
      }
      
      inviteFields.push(inviteStats.join('\n'));

      inviteEmbed.addFields({
        name: '📊 Invite Stats',
        value: inviteFields.join('\n\n'),
        inline: false
      });

      embeds.push(inviteEmbed);
    }

    // Moderation embed
    const moderationEmbed = new EmbedBuilder()
      .setTitle('⚖️ Moderation Information')
      .setColor('#FF6B6B')
      .setTimestamp();

    const moderationFields = [];

    // Mute information
    if (userInfo.activeMute) {
      const expiresTimestamp = Math.floor(parseInt(userInfo.activeMute.expires) / 1000);
      moderationFields.push([
        `**🔇 CURRENTLY MUTED**`,
        `• Reason: ${userInfo.activeMute.reason}`,
        `• Duration: ${userInfo.activeMute.length}`,
        `• Expires: <t:${expiresTimestamp}:F> (<t:${expiresTimestamp}:R>)`,
        `• Actioned by: <@${userInfo.activeMute.actioned_by}>`
      ].join('\n'));
    }

    // Moderation history
    const historyParts = [];
    if (userInfo.moderationHistory.past_mutes > 0) {
      historyParts.push(`Past Mutes: ${userInfo.moderationHistory.past_mutes}`);
    }
    if (userInfo.userStats) {
      if (userInfo.userStats.banned > 0) historyParts.push(`Bans: ${userInfo.userStats.banned}`);
      if (userInfo.userStats.kicked > 0) historyParts.push(`Kicks: ${userInfo.userStats.kicked}`);
      if (userInfo.userStats.warned > 0) historyParts.push(`Warnings: ${userInfo.userStats.warned}`);
      if (userInfo.userStats.timeout > 0) historyParts.push(`Timeouts: ${userInfo.userStats.timeout}`);
    }

    if (historyParts.length > 0) {
      moderationFields.push(`**📊 Moderation History:**\n${historyParts.join(' • ')}`);
    }

    // AI Moderation data
    if (userInfo.aiModerationData && userInfo.aiModerationData.total_filtered_messages > 0) {
      const aiData = userInfo.aiModerationData;
      const flaggedCategories = [];
      if (aiData.total_hate > 0) flaggedCategories.push(`Hate: ${aiData.total_hate}`);
      if (aiData.total_harassment > 0) flaggedCategories.push(`Harassment: ${aiData.total_harassment}`);
      if (aiData.total_self_harm > 0) flaggedCategories.push(`Self-harm: ${aiData.total_self_harm}`);
      if (aiData.total_sexual > 0) flaggedCategories.push(`Sexual: ${aiData.total_sexual}`);
      if (aiData.total_violence > 0) flaggedCategories.push(`Violence: ${aiData.total_violence}`);

      moderationFields.push([
        `**🤖 AI Moderation Data:**`,
        `• Total Filtered Messages: ${aiData.total_filtered_messages}`,
        `• Categories: ${flaggedCategories.join(', ') || 'None'}`,
        `• Last Filtered: <t:${Math.floor(new Date(aiData.last_filtered).getTime() / 1000)}:R>`
      ].join('\n'));
    }

    if (moderationFields.length > 0) {
      moderationEmbed.addFields({
        name: 'Moderation Summary',
        value: moderationFields.join('\n\n'),
        inline: false
      });
    } else {
      moderationEmbed.addFields({
        name: 'Moderation Summary',
        value: '✅ **Clean record** - No moderation actions found',
        inline: false
      });
    }

    // Add user stats if available
    if (userInfo.userStats) {
      const stats = userInfo.userStats;
      const additionalInfo = [];
      
      if (stats.messages) {
        additionalInfo.push(`Messages Tracked: ${stats.messages}`);
      }
      if (stats.ignore) {
        additionalInfo.push(`⚠️ **User is on ignore list**`);
      }
      
      if (additionalInfo.length > 0) {
        moderationEmbed.addFields({
          name: 'Additional Info',
          value: additionalInfo.join('\n'),
          inline: false
        });
      }
    }

    embeds.push(moderationEmbed);

    return embeds;
  }
,

  // Rate limit: 2 seconds 
  rateLimit: 2000,
};
