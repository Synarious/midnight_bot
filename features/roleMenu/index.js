const { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../../data/database.js');

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
 * Handle role menu button interactions (refresh button, etc.)
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('role_menu_')) return false;

	// Allow disabling Role Menus per guild
	try {
		const guildId = interaction.guild?.id;
		if (guildId) {
			const enabled = await db.isRoleMenusEnabled(guildId);
			if (!enabled) {
				return interaction.reply({
					content: '⚠️ Role Menus are disabled on this server.',
					ephemeral: true
				});
			}
		}
	} catch (e) {
		// fail-open
	}

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
		await interaction.reply({
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
        return true;

    } catch (error) {
        console.error('[roleMenu] Error in handleButton:', error);
        await interaction.reply({ content: 'An error occurred while processing the button.', ephemeral: true }).catch(() => {});
        return false;
    }
}

/**
 * Handle role menu select interactions
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleSelect(interaction) {
    if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith('role_menu_')) return false;

	// Allow disabling Role Menus per guild
	try {
		const guildId = interaction.guild?.id;
		if (guildId) {
			const enabled = await db.isRoleMenusEnabled(guildId);
			if (!enabled) {
				return interaction.reply({
					content: '⚠️ Role Menus are disabled on this server.',
					ephemeral: true
				});
			}
		}
	} catch (e) {
		// fail-open
	}

    // Check if user is muted
	if (isMuted(interaction.member)) {
		return interaction.reply({
			content: '❌ You cannot interact with the role menu while muted.',
			ephemeral: true
		});
	}

    try {
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

        // Remove all roles in this category that are not selected
        const rolesToRemove = categoryRoleIds.filter(id => 
            interaction.member.roles.cache.has(id) && !selectedRoleIds.includes(id)
        );

        // Add selected roles that the user doesn't have
        const rolesToAdd = selectedRoleIds.filter(id => 
            !interaction.member.roles.cache.has(id)
        );

        // Perform role updates
		if (rolesToRemove.length > 0) {
			await interaction.member.roles.remove(rolesToRemove);
		}
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

		// Send ephemeral response
		await interaction.reply({
			content: message,
			ephemeral: true,
			fetchReply: true
		});

		// Delete the confirmation message after 2 minutes
		setTimeout(async () => {
			try {
				await interaction.deleteReply();
			} catch (error) {
				console.log('Could not delete role update confirmation (already deleted or expired)');
			}
		}, 120000);

        return true;

    } catch (error) {
        console.error('[roleMenu] Error in handleSelect:', error);
        await interaction.reply({ content: 'An error occurred while processing your selection.', ephemeral: true }).catch(() => {});
        return false;
    }
}

module.exports = {
    handleButton,
    handleSelect,
    createRoleMenuEmbed,
    createRefreshButton,
    ROLE_CATEGORIES,

    // Rate limits for role menu interactions
    rateLimits: {
        button: 2000,   // 2 seconds between button clicks
        select: 2000,   // 2 seconds between select menu interactions
    },
};
