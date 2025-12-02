const { Events, MessageFlags } = require('discord.js');
const rateLimiter = require('../utils/rateLimiter');

// Import feature handlers
const onboarding = require('../features/onboarding');
const wowGuild = require('../features/onboarding/wowGuild');
const wowguildGuest = require('../features/onboarding/wowguildGuest');
const moderation = require('../features/moderation');
const roleMenu = require('../features/roleMenu');

// Feature registry for better scalability and maintenance
// Order matters: features are checked in this order for each interaction
const FEATURES = [
    { name: 'onboarding', module: onboarding },
    { name: 'wowGuild', module: wowGuild },
    { name: 'wowguildGuest', module: wowguildGuest },
    { name: 'moderation', module: moderation },
    { name: 'roleMenu', module: roleMenu }
];

// Default rate limits (fallbacks when command/feature doesn't specify)
const DEFAULT_RATE_LIMITS = {
    command: 3000,   // 3 seconds default for commands
    button: 2000,    // 2 seconds for buttons
    select: 2000,    // 2 seconds for select menus
    modal: 3000,     // 3 seconds for modals
};

/**
 * Get rate limit for a command
 * @param {Object} command - Command object with optional rateLimit property
 * @returns {number} - Rate limit in milliseconds
 */
function getCommandRateLimit(command) {
    return command?.rateLimit || DEFAULT_RATE_LIMITS.command;
}

/**
 * Get rate limit for a feature interaction
 * @param {Object} feature - Feature module with optional rateLimits property
 * @param {string} type - Interaction type ('button', 'select', 'modal')
 * @returns {number} - Rate limit in milliseconds
 */
function getFeatureRateLimit(feature, type) {
    return feature?.rateLimits?.[type] || DEFAULT_RATE_LIMITS[type];
}


module.exports = {
    name: Events.InteractionCreate,
    getRateLimitStats: rateLimiter.getRateLimitStats, // Export for /rates command
    async execute(interaction) {
        // Update active user count for stats
        interaction.client.rateLimitActiveUsers = rateLimiter.getActiveUserCount();
        
        try {
            // Handle slash commands
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.slashCommands.get(interaction.commandName);

                if (!command) {
                    console.error(`[interactionCreate] No slash command matching ${interaction.commandName} was found.`);
                    return;
                }

                // Get rate limit for this command (from command.rateLimit or default)
                const limitMs = getCommandRateLimit(command);
                
                // Check rate limit
                const rateLimitCheck = rateLimiter.checkRateLimit(interaction.user.id, interaction.commandName, limitMs);
                if (rateLimitCheck.limited) {
                    const remainingSec = Math.ceil(rateLimitCheck.remainingMs / 1000);
                    console.warn(`[interactionCreate] Rate limit hit: command=${interaction.commandName} | User: ${interaction.user.tag} (${interaction.user.id}) | Remaining: ${remainingSec}s`);
                    
                    await rateLimiter.sendRateLimitResponse(interaction, rateLimitCheck.remainingMs, interaction.commandName);
                    return;
                }

                // Attach DB to interaction
                interaction.client.botStorage = require('../data/database.js');
                
                console.log(`[interactionCreate] Executing command: ${interaction.commandName} | User: ${interaction.user.tag} (${interaction.user.id}) | Guild: ${interaction.guild?.id || 'DM'}`);
                
                await command.execute(interaction);
                return;
            }

            // Determine interaction type and handler method name
            const handlerType = interaction.isButton() ? 'button' 
                : interaction.isStringSelectMenu() ? 'select'
                : interaction.isModalSubmit() ? 'modal'
                : null;

            if (!handlerType) {
                console.warn(`[interactionCreate] Unknown interaction type from user ${interaction.user.id}`);
                return;
            }

            const handlerMethod = `handle${handlerType.charAt(0).toUpperCase() + handlerType.slice(1)}`;

            // Try each feature's handler in order
            let errorHandled = false;
            for (const feature of FEATURES) {
                if (typeof feature.module[handlerMethod] === 'function') {
                    // Get rate limit for this feature interaction
                    const limitMs = getFeatureRateLimit(feature.module, handlerType);
                    
                    // Rate limiting check using customId for specific tracking
                    // Do not touch the timestamp yet; only reserve the slot after the handler confirms it handled the interaction
                    const rateLimitCheck = rateLimiter.checkRateLimit(interaction.user.id, interaction.customId, limitMs, false);
                    if (rateLimitCheck.limited) {
                        const remainingSec = Math.ceil(rateLimitCheck.remainingMs / 1000);
                        console.warn(`[interactionCreate] Rate limit hit: ${handlerType}=${interaction.customId} | Feature: ${feature.name} | User: ${interaction.user.tag} (${interaction.user.id}) | Remaining: ${remainingSec}s`);
                        
                        await rateLimiter.sendRateLimitResponse(interaction, rateLimitCheck.remainingMs, interaction.customId);
                        return;
                    }
                    
                    try {
                        const handled = await feature.module[handlerMethod](interaction);
                        if (handled) {
                            // Touch the rate limit now that the feature actually handled the interaction
                            try { rateLimiter.touchRateLimit(interaction.user.id, interaction.customId); } catch (e) { }
                            console.log(`[interactionCreate] ${handlerType} handled by ${feature.name} | CustomId: ${interaction.customId} | User: ${interaction.user.tag} (${interaction.user.id})`);
                            return;
                        }
                    } catch (featureError) {
                        // Log feature-specific errors
                        console.error(`[interactionCreate] Error in ${feature.name}.${handlerMethod}:`, featureError);
                        
                        // Send error response if not already replied/deferred
                            if (!interaction.replied && !interaction.deferred && !errorHandled) {
                                await interaction.reply({
                                    content: 'An error occurred while processing this interaction.',
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => {});
                                errorHandled = true;
                            }
                        // Stop trying other features after an error
                        return;
                    }
                }
            }

            // If no feature handled it, log with more context
            console.warn(`[interactionCreate] Unhandled ${handlerType} | CustomId: ${interaction.customId} | User: ${interaction.user.tag} (${interaction.user.id}) | Guild: ${interaction.guild?.id || 'DM'}`);

        } catch (error) {
            console.error('[interactionCreate] Error handling interaction:', error);
            console.error('[interactionCreate] Error details:', {
                type: interaction.type,
                customId: interaction.customId || 'N/A',
                userId: interaction.user?.id,
                guildId: interaction.guild?.id
            });

            const errorMessage = {
                content: 'There was an error while processing your interaction!',
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage).catch(() => {});
            } else {
                await interaction.reply(errorMessage).catch(() => {});
            }
        }
    },
};
