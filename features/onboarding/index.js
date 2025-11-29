const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

// ==================== ONBOARDING CONFIGURATION ====================
// Gate role that is removed when user completes captcha
const GATE_ROLE_ID = '1425702277410455654';

const ONBOARDING_CATEGORIES = [
    {
        name: 'Pronouns',
        description: 'Select your pronouns',
        emoji: '🏳️‍🌈',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1346026355749425162', name: 'He/Him', emoji: '👨', key: 'hehim' },
            { id: '1346026308253122591', name: 'She/Her', emoji: '👩', key: 'sheher' },
            { id: '1346026355112022036', name: 'They/Them', emoji: '🧑', key: 'theythem' }
        ]
    },
    {
        name: 'Region',
        description: 'Select your region',
        emoji: '🌍',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1346009391907737631', name: 'North America', emoji: '🌎', key: 'na' },
            { id: '1346008779929550891', name: 'South America', emoji: '🌎', key: 'sa' },
            { id: '1346007791344680980', name: 'Europe', emoji: '🌍', key: 'eu' },
            { id: '1346008958178955366', name: 'Asia', emoji: '🌏', key: 'asia' },
            { id: '1346008958178955366', name: 'Australia', emoji: '🦘', key: 'oceania' },
            { id: '1346009038306934836', name: 'Africa', emoji: '🌍', key: 'africa' }
        ]
    },
    {
        name: 'Age',
        description: 'Select your age range',
        emoji: '🎂',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1364164214272561203', name: '18-25', emoji: '🔞', key: 'age_18_25' },
            { id: '1346238384003219577', name: '25+', emoji: '🔞', key: 'age_25_plus' }
        ]
    },
    {
        name: 'Gaming',
        description: 'Do you enjoy video gaming?',
        emoji: '🎮',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1363056342088290314', name: 'Gamer', emoji: '🎮', key: 'gamer' },
            { id: '1363056678299504710', name: 'Grass Toucher', emoji: '🌱', key: 'grass' }
        ]
    }
];

/**
 * Get category by name
 */
function getCategoryByName(categoryName) {
    return ONBOARDING_CATEGORIES.find(cat => cat.name === categoryName);
}

// ==================== INTERNAL STATE & SCHEDULER ====================
// Captcha/session state (previously in modules/onboarding.js)
const activeCaptchas = new Map();
const userSelections = new Map();
const timeouts = new Map(); // scheduler state

const EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

function generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i += 1) {
        const idx = Math.floor(Math.random() * alphabet.length);
        code += alphabet[idx];
    }
    return code;
}

function getDefaultSelection() {
    return {
        pronoun: null,
        continent: null,
        age: null,
        gaming: null,
    };
}

// Captcha/session management
function getSelections(userId) {
    return userSelections.get(userId) || getDefaultSelection();
}

function setSelection(userId, category, data) {
    const current = getSelections(userId);
    const updated = { ...current, [category]: data };
    userSelections.set(userId, updated);
    return updated;
}

function clearSelections(userId) {
    userSelections.delete(userId);
}

function createSession(userId, meta = null) {
    const code = generateCode();
    const selections = meta ?? getSelections(userId);
    const expiresAt = Date.now() + EXPIRATION_MS;
    activeCaptchas.set(userId, { code, meta: selections, expiresAt });
    return { code, expiresAt, meta: selections };
}

function validateSession(userId, submittedCode) {
    const entry = activeCaptchas.get(userId);

    if (!entry) {
        return { success: false, reason: 'missing' };
    }

    if (Date.now() > entry.expiresAt) {
        activeCaptchas.delete(userId);
        return { success: false, reason: 'expired' };
    }

    const sanitized = submittedCode.trim().toUpperCase();
    if (sanitized !== entry.code.toUpperCase()) {
        return { success: false, reason: 'mismatch' };
    }

    activeCaptchas.delete(userId);
    return { success: true, meta: entry.meta };
}

function clearSession(userId) {
    activeCaptchas.delete(userId);
}

function clearAllState(userId) {
    clearSession(userId);
    clearSelections(userId);
}

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [userId, entry] of activeCaptchas.entries()) {
        if (entry.expiresAt <= now) {
            activeCaptchas.delete(userId);
        }
    }
}

// Scheduler API
function schedule(userId, fn, delay) {
    // If a timeout already exists, clear it first
    if (timeouts.has(userId)) {
        clearTimeout(timeouts.get(userId));
    }

    const t = setTimeout(async () => {
        try {
            await fn(); // await the callback if it's async
        } catch (err) {
            console.error(`[onboardingScheduler] error in scheduled callback for ${userId}:`, err);
        } finally {
            timeouts.delete(userId); // delete only after callback fully completes
        }
    }, delay);

    timeouts.set(userId, t);
    console.debug(`[onboardingScheduler] scheduled timeout for ${userId} in ${delay}ms`);
    return t;
}

function cancel(userId) {
    const t = timeouts.get(userId);
    if (t) {
        clearTimeout(t);
        timeouts.delete(userId);
        console.debug(`[onboardingScheduler] cancelled timeout for ${userId}`);
        return true;
    }
    return false;
}

function has(userId) {
    return timeouts.has(userId);
}

// ==================== INTERACTION HANDLERS ====================

/**
 * Handle onboarding finish button interaction
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleButton(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'onboarding_finish') return false;

    try {
        let state = getSelections(interaction.user.id);

        // If selections are missing (e.g., due to race or storage issue), fall back to checking member roles directly
        const memberForCheck = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        const ensureSelectionFromRoles = (categoryName, storageKey) => {
            if (state[storageKey]) return;
            const cat = getCategoryByName(categoryName);
            if (!cat || !Array.isArray(cat.roles)) return;
            for (const r of cat.roles) {
                if (memberForCheck.roles.cache.has(r.id)) {
                    state = { ...state, [storageKey]: { key: r.key, label: r.name, roleId: r.id } };
                    break;
                }
            }
        };

        ensureSelectionFromRoles('Pronouns', 'pronoun');
        ensureSelectionFromRoles('Region', 'continent');
        ensureSelectionFromRoles('Age', 'age');
        ensureSelectionFromRoles('Gaming', 'gaming');

        if (!state.pronoun) {
            await interaction.reply({ content: '⚠️ Please select your pronouns before finishing.', ephemeral: true });
            return true;
        }

        if (!state.continent) {
            await interaction.reply({ content: '⚠️ Please select your region before finishing.', ephemeral: true });
            return true;
        }

        if (!state.age) {
            await interaction.reply({ content: '⚠️ Please select your age group before finishing.', ephemeral: true });
            return true;
        }

        if (!state.gaming) {
            await interaction.reply({ content: '⚠️ Please select your gaming preference before finishing.', ephemeral: true });
            return true;
        }

        cleanupExpiredSessions();
        const { code } = createSession(interaction.user.id, state);

        const modal = new ModalBuilder()
            .setCustomId('captcha_modal')
            .setTitle('Captcha Verification');

        const captchaInput = new TextInputBuilder()
            .setCustomId('captchaInput')
            .setLabel(`Enter captcha: ${code}`)
            .setPlaceholder('Type the code exactly as shown above.')
            .setMinLength(code.length)
            .setMaxLength(code.length)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(captchaInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
        return true;

    } catch (err) {
        console.error('[onboarding] handleButton error:', err);
        return false;
    }
}

/**
 * Handle onboarding select menu interaction
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleSelect(interaction) {
    if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith('onboarding_select:')) return false;

    try {
        const categoryKey = interaction.customId.split(':')[1];
        
        // Map category keys to category names
        const categoryNameMap = {
            'pronoun': 'Pronouns',
            'pronouns': 'Pronouns',
            'continent': 'Region',
            'region': 'Region',
            'age': 'Age',
            'gaming': 'Gaming'
        };
        
        const categoryName = categoryNameMap[categoryKey.toLowerCase()];
        const categoryConfig = getCategoryByName(categoryName);

        if (!categoryConfig) {
            await interaction.reply({ content: '⚠️ This selection is not configured yet. Please notify an administrator.', ephemeral: true });
            return true;
        }

        const choices = categoryConfig.roles;
        
        if (!choices || !Array.isArray(choices)) {
            await interaction.reply({ content: '⚠️ This selection is not configured yet. Please notify an administrator.', ephemeral: true });
            return true;
        }

        const selectedKey = interaction.values?.[0];
        const choice = choices.find(option => option.key === selectedKey);

        if (!choice) {
            await interaction.reply({ content: '⚠️ Unknown selection. Please try again.', ephemeral: true });
            return true;
        }

        const roleId = choice.id;
        const roleIdIsValid = typeof roleId === 'string' && /^\d{17,20}$/.test(roleId);

        if (!roleIdIsValid) {
            await interaction.reply({ content: '⚠️ Role ID for this option is not configured. Please notify an administrator.', ephemeral: true });
            return true;
        }

        const guildRole = interaction.guild.roles.cache.get(roleId);

        if (!guildRole) {
            await interaction.reply({ content: '⚠️ The configured role could not be found in this server. Please notify an administrator.', ephemeral: true });
            return true;
        }

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);

        // Get all other role IDs in this category to remove them
        const siblingRoleIds = choices
            .filter(opt => opt.id !== roleId)
            .map(opt => opt.id)
            .filter(id => /^\d{17,20}$/.test(id));

        const rolesToRemove = member.roles.cache.filter(role => siblingRoleIds.includes(role.id));

        try {
            if (rolesToRemove.size) {
                await member.roles.remove([...rolesToRemove.keys()]);
            }

            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId);
            }
        } catch (roleError) {
            console.error('[onboarding] Failed to update roles for selection:', roleError);
            await interaction.reply({ content: '⚠️ I could not update your roles. Please contact a moderator.', ephemeral: true });
            return true;
        }

        // Normalize storage key to the singular keys used by captchaManager
        let storageKey;
        switch (categoryKey.toLowerCase()) {
            case 'pronouns':
            case 'pronoun':
                storageKey = 'pronoun';
                break;
            case 'region':
            case 'continent':
                storageKey = 'continent';
                break;
            case 'age':
                storageKey = 'age';
                break;
            case 'gaming':
                storageKey = 'gaming';
                break;
        default:
            storageKey = categoryKey;
        }

        setSelection(interaction.user.id, storageKey, {
            key: choice.key,
            label: choice.name,
            roleId,
        });        // Debug: log stored selections for troubleshooting
        try {
            const debugSelections = getSelections(interaction.user.id);
            console.debug('[onboarding-debug] stored selections for', interaction.user.id, debugSelections);
        } catch (dbgErr) {
            console.error('[onboarding-debug] failed to read stored selections:', dbgErr);
        }

        // Acknowledge the select interaction silently (no visible reply)
        try {
            await interaction.deferUpdate();
        } catch (ackErr) {
            // Unable to defer update; intentionally do not reply to keep channel clean
            console.warn('[onboarding] Could not deferUpdate interaction; no reply will be sent.');
        }
        return true;

    } catch (err) {
        console.error('[onboarding] handleSelect error:', err);
        return false;
    }
}

/**
 * Handle onboarding modal submission (captcha verification)
 * @param {import('discord.js').ModalSubmitInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleModal(interaction) {
    if (!interaction.isModalSubmit() || interaction.customId !== 'captcha_modal') return false;

    try {
        const submittedCode = interaction.fields.getTextInputValue('captchaInput');
        const validation = validateSession(interaction.user.id, submittedCode);

        if (!validation.success) {
            let reasonMessage = 'The code you entered was incorrect or expired. Please try again.';
            if (validation.reason === 'expired') {
                reasonMessage = 'The captcha has expired. Click the finish button again to receive a new code.';
            } else if (validation.reason === 'missing') {
                reasonMessage = 'No active captcha found. Click the finish button to receive a fresh code.';
            }

            // Log failed attempt to the moderation/log channel
            try {
                const logChannelId = '1425705491274928138';
                const logChannel = interaction.guild.channels.cache.get(logChannelId) || await interaction.guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel && logChannel.send) {
                    const currentSelections = getSelections(interaction.user.id) || {};
                    const selectionsText = Object.entries(currentSelections).map(([k, v]) => `${k}: ${v?.label || v?.name || v?.key || v}`).join('\n') || 'No selections';

                    // Include what the user submitted when applicable
                    let providedText = '';
                    if (validation.reason === 'mismatch') {
                        const provided = submittedCode ?? '(no input)';
                        providedText = `\nProvided value: ${provided}`;
                    }

                    // Different message for missing vs other failures
                    if (validation.reason === 'missing') {
                        await logChannel.send(`⚠️ Missing captcha session when user attempted verification\nUser: ${interaction.user.tag} (${interaction.user.id})\nSelections:\n${selectionsText}`);
                    } else {
                        await logChannel.send(`⚠️ Failed captcha attempt\nUser: ${interaction.user.tag} (${interaction.user.id})\nReason: ${validation.reason || 'unknown'}${providedText}\nSelections:\n${selectionsText}`);
                    }
                }
            } catch (logError) {
                console.error('[onboarding] Failed to log failed captcha attempt:', logError);
            }

            await interaction.reply({ content: `❌ ${reasonMessage}`, ephemeral: true });
            return true;
        }

        const meta = validation.meta || {};
        clearSelections(interaction.user.id);
        
        // Cancel any scheduled onboarding kick for this user
        try {
            const cancelled = cancel(interaction.user.id);
            console.debug('[onboarding] scheduled kick cancel result for', interaction.user.id, cancelled);

            // Send a cancellation log to the moderation/log channel so we can trace it
            try {
                const LOG_CHANNEL_ID = '1425705491274928138';
                const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID) || await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                if (logChannel && logChannel.send) {
                    const memberForLog = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                    const accountCreatedTs = memberForLog ? memberForLog.user.createdTimestamp : (interaction.user?.createdTimestamp || Date.now());
                    const roleNames = memberForLog ? memberForLog.roles.cache.filter(r => r.id !== memberForLog.guild.id).map(r => r.name).slice(0, 5) : [];
                    const status = cancelled ? 'scheduled kick was cancelled' : 'no scheduled kick present';
                    const msg = `[OB 4/4 ] **Onboarding Completed** ${memberForLog ? memberForLog.toString() : `<@${interaction.user.id}>`} | UserID: ${interaction.user.id} | <t:${Math.floor(accountCreatedTs/1000)}:R> | Roles = ${roleNames.length ? roleNames.join(', ') : 'none'} | ${status}`;
                    await logChannel.send({ content: msg }).catch(() => null);
                }
            } catch (logErr) {
                console.error('[onboarding] Failed to send scheduled-cancel log:', logErr);
            }
        } catch (schErr) {
            console.warn('[onboarding] Could not cancel scheduled kick (scheduler missing?):', schErr);
        }

        // Remove gate role if present
        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        
        if (member.roles.cache.has(GATE_ROLE_ID)) {
            try {
                await member.roles.remove(GATE_ROLE_ID);
                console.log(`[onboarding] Removed gate role from user ${interaction.user.id}`);
            } catch (error) {
                console.error(`[onboarding] Failed to remove gate role from user ${interaction.user.id}:`, error);
            }
        }

        const pronounLabel = meta.pronoun?.label || meta.pronoun?.name || 'your pronouns';
        const regionLabel = meta.continent?.label || meta.continent?.name;
        const ageLabel = meta.age?.label || meta.age?.name;
        const gamingLabel = meta.gaming?.label || meta.gaming?.name;

        const summaryParts = [`Preferred pronouns: **${pronounLabel}**`];
        if (regionLabel) {
            summaryParts.push(`Region: **${regionLabel}**`);
        }
        if (ageLabel) {
            summaryParts.push(`Age group: **${ageLabel}**`);
        }
        if (gamingLabel) {
            summaryParts.push(`Gaming: **${gamingLabel}**`);
        }

        const summary = summaryParts.join('\n');

        // Send welcome messages to a dedicated welcome channel and an embed to the welcome-crew channel
        (async () => {
            try {
                const { EmbedBuilder } = require('discord.js');
                const welcomeChannelId = '1346007514193330178'; // welcome-channel
                const crewChannelId = '1372108730786910258'; // welcome-crew embed channel

                const welcomeChannel = interaction.guild.channels.cache.get(welcomeChannelId) || await interaction.guild.channels.fetch(welcomeChannelId).catch(() => null);
                const crewChannel = interaction.guild.channels.cache.get(crewChannelId) || await interaction.guild.channels.fetch(crewChannelId).catch(() => null);

                const userMention = `<@${interaction.user.id}>`;
                const userName = interaction.user.username || interaction.user.tag || interaction.user.id;

                const templates = [
                    `Welcome ${userMention}! Love the name — it's got character. Glad you made it.`,
                    `Hey ${userMention}, nice avatar! We're happy you joined — no pressure to reply, just say hi when you feel like it.`,
                    `${userMention} has arrived — stylish name. Hope you like it here.`,
                    `Nice to see you ${userMention}! Your profile looks cool — enjoy your stay.`,
                    `Welcome ${userMention}! We already think your username is awesome. Make yourself at home.`,
                    `Hey ${userMention}, welcome aboard — that name is unforgettable in the best way.`,
                    `Yo ${userMention}! Your profile pic slaps. Stick around and say hello whenever.`,
                    `${userMention} — welcome! No need to reply, but if you want, tell us your favourite hobby.`,
                    `Hi ${userMention}! That display name is neat. Hope you find some fun here.`,
                    `Welcome ${userMention}! Quiet arrival? That's cool — lurkers welcome too.`,
                    `Hey ${userMention}, glad you joined — your username gives off good vibes.`,
                    `Welcome ${userMention}! If your name had a theme song, we'd be playing it.`,
                    `Hi ${userMention}! Love the handle — hope the server feels like a good fit.`,
                    `Welcome ${userMention}! Your profile caught our eye — feel free to poke around.`,
                    `${userMention}, welcome! If you're into games/music/art, you'll find people here.`,
                    `Hey ${userMention}, that avatar is cool — nice to have you here.`,
                    `Welcome ${userMention}! No intro required, but we'd love to hear what you're into when you're ready.`,
                    `Nice to meet you ${userMention}! You picked a solid username — enjoy the server.`,
                    `Welcome ${userMention}! If you want recs, ask later — for now, enjoy the vibes.`,
                    `Hey ${userMention}, subtle flex: great username. Welcome aboard.`,
                    `Welcome ${userMention}! Your name says "I belong here" — and you do.`,
                    `Hi ${userMention}! We appreciate a tasteful profile pic — welcome.`,
                    `Welcome ${userMention}! Pop in when you feel like it — we're chill.`,
                    `Hey ${userMention}, love the energy your name gives — glad you joined.`,
                    `Welcome ${userMention}! Your join made the server a little cooler already.`
                ];

                const pick = templates[Math.floor(Math.random() * templates.length)];

                if (welcomeChannel && welcomeChannel.send) {
                    await welcomeChannel.send({ content: pick }).catch(() => null);
                }

                if (crewChannel && crewChannel.send) {
                    const avatarUrl = member.user.displayAvatarURL({ size: 1024, extension: 'png' });
                    const embed = new EmbedBuilder()
                        .setColor(0xFFFFFF)
                        .setThumbnail(avatarUrl)
                        .addFields(
                            { name: 'Names:', value: `${member.toString()}  | \`${userName}\` | \`${member.user.globalName || ''}\``, inline: false },
                            { name: 'Go To Location:', value: `https://discordapp.com/channels/${member.guild.id}/${welcomeChannelId}`, inline: false },
                            { name: 'Want To Disable Notifications?:', value: 'Go Here: <id:customize>', inline: false },
                        );

                    await crewChannel.send({ embeds: [embed] }).catch(() => null);
                }
            } catch (sendError) {
                console.error('[onboarding] Failed to send welcome messages:', sendError);
            }
        })();

        // Log successful onboarding to moderation/log channel
        try {
            const LOG_CHANNEL_ID = '1425705491274928138';
            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID) || await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
            if (logChannel && logChannel.send) {
                const state = meta || {};
                const getLabel = (v) => (v && (v.label || v.name || v.key)) || '—';

                const memberForLog = member ?? (interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
                const accountCreatedTs = memberForLog ? memberForLog.user.createdTimestamp : (interaction.user?.createdTimestamp || Date.now());
                const roleNames = memberForLog ? memberForLog.roles.cache.filter(r => r.id !== memberForLog.guild.id).map(r => r.name).slice(0, 5) : [];
                const pronounLabelLog = getLabel(state.pronoun);
                const msg = `[OB 4/4 ] **Onboarding Completed** ${memberForLog ? memberForLog.toString() : `<@${interaction.user.id}>`} | UserID: ${interaction.user.id} | <t:${Math.floor(accountCreatedTs/1000)}:R> | Roles = ${roleNames.length ? roleNames.join(', ') : 'none'} | Pronoun=${pronounLabelLog}`;
                await logChannel.send({ content: msg }).catch(() => null);
            }
        } catch (logErr) {
            console.error('[onboarding] Failed to send onboarding success log:', logErr);
        }

        await interaction.reply({
            content: `✅ Captcha complete! Welcome aboard!\n${summary}`,
            ephemeral: true,
        });
        return true;

    } catch (err) {
        console.error('[onboarding] handleModal error:', err);
        try {
            await interaction.reply({ content: 'There was an error processing your submission.', ephemeral: true });
        } catch (e) {
            console.error('[onboarding] Failed to send error reply:', e);
        }
        return false;
    }
}

module.exports = {
    // Interaction handlers
    handleButton,
    handleSelect,
    handleModal,
    
    // Scheduler API (for events/guildMemberAdd.js)
    schedule,
    cancel,
    has,
    
    // Captcha/session API (for potential future use)
    createSession,
    validateSession,
    clearSession,
    clearSelections,
    clearAllState,
    setSelection,
    getSelections,
    cleanupExpiredSessions,
    EXPIRATION_MS,
    
    // Configuration exports (for commands that need onboarding config)
    ONBOARDING_CATEGORIES,
    GATE_ROLE_ID,
    getCategoryByName,

    // Rate limits for onboarding interactions
    rateLimits: {
        button: 2000,        // 2 seconds between button clicks
        select: 2000,        // 2 seconds between select menu interactions
        modal: 5000,         // 5 seconds between modal submissions
    },
};

