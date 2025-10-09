const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// ==================== CONFIGURATION ====================
// Easy to modify - add or remove categories and roles here
const ROLE_CATEGORIES = [
	{
		name: 'Age',
		description: 'Select your age range',
		emoji: '🎂',
		selectionType: 'REQUIRED_ONE', // REQUIRED_ONE, ONLY_ONE, MULTIPLE, NONE_OR_ONE, NONE_OR_MULTIPLE
		roles: [
			{ id: '1346238384003219577', name: '25+', emoji: '🔞' },
			{ id: '1364164214272561203', name: '18-25', emoji: '🔞' }
		]
	},
	{
		name: 'Name Color',
		description: 'Choose your name color',
		emoji: '🎨',
		selectionType: 'ONLY_ONE',
		roles: [
			{ id: '1346009390783922188', name: 'Bright Red', emoji: '🔴', requiresNitro: true },
			{ id: '1348904975698497659', name: 'Pastel Pink', emoji: '🌸', requiresNitro: true },
			{ id: '1348906862074003457', name: 'Snow', emoji: '⚪', requiresNitro: true },
			{ id: '1348904935856541738', name: 'Red', emoji: '❤️' },
			{ id: '1348904973391364198', name: 'Orange', emoji: '🧡' },
			{ id: '1348907027530780785', name: 'Teal', emoji: '💚' },
			{ id: '1346009391521992704', name: 'Egg Plant', emoji: '🍆' },
			{ id: '1346009392985935882', name: 'Black', emoji: '🖤' },
			{ id: '1348904974029033499', name: 'Pink', emoji: '💗' }
		]
	},
	{
		name: 'DMs',
		description: 'Set your DM preference',
		emoji: '💬',
		selectionType: 'ONLY_ONE',
		roles: [
			{ id: '1363363837306212409', name: 'Open DMs', emoji: '✅' },
			{ id: '1363362517291765911', name: 'Do Not DM', emoji: '⛔' }
		]
	},
	{
		name: 'Pings',
		description: 'Choose notification roles',
		emoji: '🔔',
		selectionType: 'MULTIPLE',
		roles: [
			{ id: '1369946509348573244', name: 'Joins🔔', emoji: '👋' },
			{ id: '1369946725279727676', name: 'Voice🔔', emoji: '🎤' },
			{ id: '1369946790836703252', name: 'Chatter🔔', emoji: '💬' },
			{ id: '1371047394619293747', name: 'Server🔔', emoji: '📢' },
			{ id: '1374269983399350272', name: 'MC🔔', emoji: '⛏️' },
			{ id: '1388032080318959646', name: 'Bump🔔', emoji: '⬆️' }
		]
	}
];

const MUTED_ROLE_ID = '1348527935509889137';

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if user is muted
 */
function isMuted(member) {
	return member.roles.cache.has(MUTED_ROLE_ID);
}

/**
 * Check if user is a server booster
 */
function isBooster(member) {
	return member.premiumSince !== null;
}

/**
 * Get category by name
 */
function getCategoryByName(categoryName) {
	return ROLE_CATEGORIES.find(cat => cat.name === categoryName);
}

/**
 * Get all role IDs from a category
 */
function getCategoryRoleIds(category) {
	return category.roles.map(role => role.id);
}

/**
 * Create embed for role menu
 */
function createRoleMenuEmbed() {
	const embed = new EmbedBuilder()
		.setTitle('🎭 Role Selection Menu')
		.setDescription('**Click the button below to open your personalized role menu!**\n\nYour current roles will be automatically selected.\n\n💎 = Requires Server Boost')
		.setColor('#5865F2')
		.setFooter({ text: 'Private menu • Auto-deletes after 2 minutes' })
		.setTimestamp();

	return embed;
}

/**
 * Create "Open Role Menu" button
 */
function createRefreshButton() {
	const button = new ButtonBuilder()
		.setCustomId('role_menu_refresh')
		.setLabel('Open Role Menu')
		.setEmoji('🎭')
		.setStyle(ButtonStyle.Primary);

	return new ActionRowBuilder().addComponents(button);
}

/**
 * Create select menus for all categories with user's current roles pre-selected
 */
function createSelectMenus(member = null) {
	const rows = [];

	for (const category of ROLE_CATEGORIES) {
		const options = category.roles.map(role => ({
			label: role.name,
			value: `${category.name}|${role.id}`,
			description: role.requiresNitro ? 'Requires Server Boost' : undefined,
			emoji: role.emoji || undefined,
			// Pre-select if user has this role
			default: member ? member.roles.cache.has(role.id) : false
		}));

		const selectMenu = new StringSelectMenuBuilder()
			.setCustomId(`role_menu_${category.name}`)
			.setPlaceholder(`Select ${category.name}`)
			.setMinValues(category.selectionType === 'REQUIRED_ONE' ? 1 : 0)
			.setMaxValues(
				category.selectionType === 'MULTIPLE' || category.selectionType === 'NONE_OR_MULTIPLE' 
					? category.roles.length 
					: 1
			)
			.addOptions(options);

		rows.push(new ActionRowBuilder().addComponents(selectMenu));
	}

	return rows;
}

/**
 * Handle refresh button click - sends personalized ephemeral role menu
 */
async function handleRefreshButton(interaction) {
	// Check if user is muted
	if (isMuted(interaction.member)) {
		return interaction.reply({
			content: '❌ You cannot interact with the role menu while muted.',
			ephemeral: true
		});
	}

	try {
		// Create personalized embed with user's current roles
		const embed = createRoleMenuEmbed();
		const selectMenus = createSelectMenus(interaction.member);

		// Send ephemeral message with pre-selected roles
		const reply = await interaction.reply({
			embeds: [embed],
			components: selectMenus,
			ephemeral: true,
			fetchReply: true
		});

		// Delete the ephemeral message after 2 minutes (120,000 ms)
		setTimeout(async () => {
			try {
				await interaction.deleteReply();
			} catch (error) {
				// Message might already be deleted or interaction expired
				console.log('Could not delete ephemeral role menu (already deleted or expired)');
			}
		}, 120000);

	} catch (error) {
		console.error('Error opening role menu:', error);
		await interaction.reply({
			content: '❌ Failed to open role menu. Please try again.',
			ephemeral: true
		});
	}
}

/**
 * Handle role selection
 */
async function handleRoleSelection(interaction) {
	// Check if user is muted
	if (isMuted(interaction.member)) {
		return interaction.reply({
			content: '❌ You cannot interact with the role menu while muted.',
			ephemeral: true
		});
	}

	const customId = interaction.customId;
	const categoryName = customId.replace('role_menu_', '');
	const category = getCategoryByName(categoryName);

	if (!category) {
		return interaction.reply({
			content: '❌ Invalid category.',
			ephemeral: true
		});
	}

	const selectedValues = interaction.values;
	const selectedRoleIds = selectedValues.map(val => val.split('|')[1]);

	// Check nitro requirements
	for (const roleId of selectedRoleIds) {
		const roleConfig = category.roles.find(r => r.id === roleId);
		if (roleConfig && roleConfig.requiresNitro && !isBooster(interaction.member)) {
			return interaction.reply({
				content: `❌ The role **${roleConfig.name}** requires Server Boost! 💎`,
				ephemeral: true
			});
		}
	}

	// Get all roles in this category
	const categoryRoleIds = getCategoryRoleIds(category);

	// Remove all roles in this category
	const rolesToRemove = categoryRoleIds.filter(id => 
		interaction.member.roles.cache.has(id) && !selectedRoleIds.includes(id)
	);

	// Add selected roles
	const rolesToAdd = selectedRoleIds.filter(id => 
		!interaction.member.roles.cache.has(id)
	);

	try {
		// Remove old roles
		if (rolesToRemove.length > 0) {
			await interaction.member.roles.remove(rolesToRemove);
		}

		// Add new roles
		if (rolesToAdd.length > 0) {
			await interaction.member.roles.add(rolesToAdd);
		}

		// Build response message
		let message = '✅ **Roles updated successfully!**\n\n';
		
		if (selectedRoleIds.length > 0) {
			const selectedRoleNames = selectedRoleIds.map(id => {
				const roleConfig = category.roles.find(r => r.id === id);
				return roleConfig ? `${roleConfig.emoji || ''} ${roleConfig.name}`.trim() : `<@&${id}>`;
			});
			message += `**${category.emoji} ${category.name}:** ${selectedRoleNames.join(', ')}`;
		} else {
			message += `**${category.emoji} ${category.name}:** No roles selected`;
		}

		// Send ephemeral response only - don't update the original message
		const reply = await interaction.reply({
			content: message,
			ephemeral: true,
			fetchReply: true
		});

		// Delete the confirmation message after 2 minutes (120,000 ms)
		setTimeout(async () => {
			try {
				await interaction.deleteReply();
			} catch (error) {
				// Message might already be deleted or interaction expired
				console.log('Could not delete role update confirmation (already deleted or expired)');
			}
		}, 120000);

	} catch (error) {
		console.error('Error updating roles:', error);
		await interaction.reply({
			content: '❌ Failed to update roles. Please contact a server administrator.',
			ephemeral: true
		});
	}
}

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

	// Export handlers for interaction collector
	handleRoleSelection,
	handleRefreshButton
};
