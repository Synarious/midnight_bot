const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createRoleMenuEmbed, createRefreshButton, ROLE_CATEGORIES } = require('../../features/roleMenu');

// ==================== COMMAND ====================

module.exports = {
	data: new SlashCommandBuilder()
		.setName('role-menu')
		.setDescription('Manage the server role selection menu')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(subcommand =>
			subcommand
				.setName('create')
				.setDescription('Create or update the role selection menu')
				.addChannelOption(option =>
					option
						.setName('channel')
						.setDescription('Channel to send the role menu (defaults to current channel)')
						.setRequired(false)
				)
		),

	async execute(interaction) {
		// Check if user has admin permissions
		if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({
				content: '❌ You need Administrator permissions to use this command.',
				ephemeral: true
			});
		}

		// Handle both slash command subcommand and prefix command
		const subcommand = interaction.options?.getSubcommand?.() || 'create';
		
		if (subcommand === 'create') {
			// Try to get channel from options, or use current channel as fallback
			let targetChannel = interaction.channel;
			
			if (interaction.options?.getChannel) {
				targetChannel = interaction.options.getChannel('channel') || interaction.channel;
			} else if (interaction.commandArgs && interaction.commandArgs.length > 0) {
				// For prefix commands: !role-menu #channel or !role-menu 123456789
				const channelArg = interaction.commandArgs[0];
				const channelIdMatch = channelArg.match(/^<#(\d+)>$|^(\d+)$/);
				const channelId = channelIdMatch ? (channelIdMatch[1] || channelIdMatch[2]) : null;
				
				if (channelId) {
					const resolvedChannel = interaction.guild.channels.cache.get(channelId);
					if (resolvedChannel) {
						targetChannel = resolvedChannel;
					}
				}
			}

			try {
				const embed = createRoleMenuEmbed();
				const refreshButton = createRefreshButton();

				// Only send the button - users will get personalized menus when they click it
				await targetChannel.send({
					embeds: [embed],
					components: [refreshButton]
				});

				// Generate detailed role report
				let report = '✅ **Role menu created successfully!**\n\n';
				report += `📍 **Channel:** ${targetChannel}\n\n`;
				report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

				const dangerousPerms = [
					'ManageNicknames',
					'KickMembers',
					'BanMembers',
					'ModerateMembers',
					'ManageMessages',
					'MentionEveryone',
					'ManageThreads',
					'Administrator',
					'ManageEvents'
				];

				for (const category of ROLE_CATEGORIES) {
					report += `**${category.emoji} ${category.name}**\n`;
					
					for (const roleConfig of category.roles) {
						const role = interaction.guild.roles.cache.get(roleConfig.id);
						
						if (!role) {
							report += `  ⚠️ **${roleConfig.name}** - ID: \`${roleConfig.id}\` - **[ROLE NOT FOUND]**\n`;
							continue;
						}

						let roleLine = `  • **${roleConfig.name}** - ID: \`${roleConfig.id}\``;
						
						if (roleConfig.requiresNitro) {
							roleLine += ' 💎';
						}

						// Check for dangerous permissions
						const foundPerms = [];
						for (const perm of dangerousPerms) {
							if (role.permissions.has(PermissionFlagsBits[perm])) {
								foundPerms.push(perm);
							}
						}

						if (foundPerms.length > 0) {
							roleLine += `\n    ⚠️ **Has Permissions:** ${foundPerms.join(', ')}`;
						}

						report += roleLine + '\n';
					}
					report += '\n';
				}

				report += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
				report += '**Legend:**\n';
				report += '💎 = Requires Server Boost\n';
				report += '⚠️ = Has moderation/management permissions\n';

				await interaction.reply({
					content: report,
					ephemeral: true
				});

			} catch (error) {
				console.error('Error creating role menu:', error);
				await interaction.reply({
					content: '❌ Failed to create role menu. Please check bot permissions.',
					ephemeral: true
				});
			}
		}
	},

  // Rate limit: 5 seconds 
  rateLimit: 5000,
};
