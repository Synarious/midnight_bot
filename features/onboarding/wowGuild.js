const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// ==================== ONBOARDING CONFIGURATION ====================
// Gate role that is removed when user completes captcha
const GATE_ROLE_ID = '1442686627481911356';

const ONBOARDING_CATEGORIES = [
    {
        name: 'Pronouns',
        description: 'Select your pronouns',
        emoji: '🏳️‍🌈',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1129265534123397200', name: 'He/Him', emoji: '👨', key: 'hehim' },
            { id: '1129265670975131751', name: 'She/Her', emoji: '👩', key: 'sheher' },
            { id: '1129265844942274642', name: 'They/Them', emoji: '🧑', key: 'theythem' }
        ]
    },
    {
        name: 'Timezone',
        description: 'Timezone',
        emoji: '🌍',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1442687306686398624', name: 'Eastern', emoji: '🌎', key: 'eastern' },
            { id: '1442687342811938878', name: 'Pacific', emoji: '🌎', key: 'pacific' },
            { id: '1442687364748283924', name: 'Central', emoji: '🌍', key: 'central' },
            { id: '1442687384222433470', name: 'Other', emoji: '🌏', key: 'other-tz' },
        ]
    },
    {
        name: 'What interests you most?',
        description: 'What interests you most?',
        emoji: '🎂',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1442987872696143882', name: 'Social', emoji: '😀', key: 'social' },
            { id: '1299236238250999839', name: 'Mythic+', emoji: '🗡️', key: 'mythic' },
            { id: '1287526603525591114', name: 'Roleplay', emoji: '❓', key: 'roleplay' },
            { id: '1328929259137274071', name: 'Collecting', emoji: '❓', key: 'collecting' },
            { id: '1442987608673226863', name: 'Raid', emoji: '🗡️', key: 'raid' },
            { id: '1292708705506426911', name: 'Gold Farms', emoji: '❓', key: 'gold-farms' }
        ]
    },
    {
        name: 'Are you an adult?',
        description: 'Select your age group',
        emoji: '🎮',
        selectionType: 'REQUIRED_ONE',
        roles: [
            { id: '1270938800499195925', name: 'Yes', emoji: '', key: 'yes_adult' },
        ]
    }
];

/**
 * Get category by name
 */
function getCategoryByName(categoryName) {
    return ONBOARDING_CATEGORIES.find(cat => cat.name === categoryName);
}

// ==================== INTERNAL STATE ====================
const userSelections = new Map();

// Blizzard (WoW) API configuration for Dawnbound verification
const WOW_REGION = 'us';
const WOW_NAMESPACE = 'profile-us';
const WOW_LOCALE = 'en_US';
// Guild/realm slugs can be overridden via env vars if you rename the guild or realm
const WOW_GUILD_SLUG = process.env.WOW_GUILD_SLUG || 'dawnbound';
const WOW_GUILD_REALM_SLUG = process.env.WOW_GUILD_REALM_SLUG || 'moon-guard';
const WOW_GUILD_LOG_CHANNEL_ID = '1443006368897306728';
const VERIFICATION_MODAL_ID = 'wow_guild_verification';
// Role to give verified WoW guild members
const WOW_VERIFIED_ROLE_ID = '1129313754778194050';

// Convenience override: set the 4-character guild code here for easy local changes.
// You can also set the env var WOW_ONBOARDING_CODE to override this value.
// Example: const WOW_ONBOARDING_CODE = 'AB12';
const WOW_ONBOARDING_CODE = process.env.WOW_ONBOARDING_CODE || 'GB16';

// Optional: restrict this feature to a set of guild IDs (comma-separated in env)
// If empty, the feature is enabled in all guilds.
const ALLOWED_GUILD_IDS = (process.env.WOW_ONBOARDING_GUILDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function isGuildAllowed(interaction) {
    if (!interaction || !interaction.guild) return false;
    if (ALLOWED_GUILD_IDS.length === 0) return true;
    return ALLOWED_GUILD_IDS.includes(interaction.guild.id);
}

function formatGuildInfo(interaction) {
    try {
        const g = interaction?.guild;
        if (!g) return '(no guild)';
        return `${g.name} (ID: ${g.id})`;
    } catch (e) {
        return '(unknown guild)';
    }
}

let blizzardTokenCache = {
    token: null,
    expiresAt: 0,
};

function getDefaultSelection() {
    return {
        pronoun: null,
        timezone: null,
        interest: null,
        adult: null,
    };
}

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

function clearAllState(userId) {
    clearSelections(userId);
}

// ==================== INTERACTION HANDLERS ====================

/**
 * Handle onboarding finish button interaction
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleButton(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'wow_finish') return false;
    if (!isGuildAllowed(interaction)) return false;

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
        ensureSelectionFromRoles('Timezone', 'timezone');
        ensureSelectionFromRoles('What interests you most?', 'interest');
        ensureSelectionFromRoles('Are you an adult?', 'adult');

        if (!state.pronoun) {
            await interaction.reply({ content: `⚠️ Please select your pronouns before finishing.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        if (!state.timezone) {
            await interaction.reply({ content: `⚠️ Please select your timezone before finishing.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        if (!state.interest) {
            await interaction.reply({ content: `⚠️ Please select what interests you most before finishing.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        if (!state.adult) {
            await interaction.reply({ content: `⚠️ Please confirm your age before finishing.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        const modal = new ModalBuilder()
            .setCustomId(VERIFICATION_MODAL_ID)
            .setTitle('WoW Guild Verification');

        const characterInput = new TextInputBuilder()
            .setCustomId('characterName')
            .setLabel('Character name')
            .setPlaceholder('Character name to look up in the Dawnbound roster (case-insensitive)')
            .setMinLength(2)
            .setMaxLength(100)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        // 4-character guild code shown in the Guild Info message next to the Discord invite
        const codeInput = new TextInputBuilder()
            .setCustomId('guildCode')
            .setLabel('Member Code (4 characters)')
            .setPlaceholder('In-game in Guild Info next to the invite')
            .setMinLength(4)
            .setMaxLength(4)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(characterInput),
            new ActionRowBuilder().addComponents(codeInput)
        );

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
    if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith('wow_select:')) return false;
    if (!isGuildAllowed(interaction)) return false;

    try {
        console.log(`[wowGuild] handleSelect triggered in guild: ${interaction.guild.name} (${interaction.guild.id})`);
        const categoryKey = interaction.customId.split(':')[1];
        
        // Map category keys to category names
        const categoryNameMap = {
            'pronoun': 'Pronouns',
            'pronouns': 'Pronouns',
            'timezone': 'Timezone',
            'continent': 'Region',
            'region': 'Region',
            'what_interests_you_most': 'What interests you most?',
            'are_you_an_adult': 'Are you an adult?',
            'age': 'Age',
            'gaming': 'Gaming'
        };
        
        const categoryName = categoryNameMap[categoryKey.toLowerCase()];
        const categoryConfig = getCategoryByName(categoryName);

        if (!categoryConfig) {
            await interaction.reply({ content: `⚠️ This selection is not configured yet. Please notify an administrator.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        const choices = categoryConfig.roles;
        
        if (!choices || !Array.isArray(choices)) {
            await interaction.reply({ content: `⚠️ This selection is not configured yet. Please notify an administrator.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        const resolvedChoices = choices.map(roleConfig => {
            const roleById = interaction.guild.roles.cache.get(roleConfig.id);

            if (roleById) {
                return { ...roleConfig, resolvedRole: roleById, resolvedRoleId: roleById.id };
            }

            const roleByName = interaction.guild.roles.cache.find(role => role.name === roleConfig.name);
            if (roleByName) {
                console.log(`[onboarding] Fallback: resolved "${roleConfig.name}" by name → ID ${roleByName.id} (config had ${roleConfig.id})`);
                return { ...roleConfig, resolvedRole: roleByName, resolvedRoleId: roleByName.id, fallbackName: true };
            }

            console.warn(`[onboarding] ⚠️ Role not found: "${roleConfig.name}" (ID ${roleConfig.id}) in guild ${interaction.guild.id}`);
            const availableRoles = interaction.guild.roles.cache.map(r => `${r.name} (${r.id})`).join(', ');
            console.warn(`[onboarding] Available roles in guild: ${availableRoles}`);
            
            return { ...roleConfig, resolvedRole: null, resolvedRoleId: null };
        });

        const selectedKey = interaction.values?.[0];
        const choice = resolvedChoices.find(option => option.key === selectedKey);

        if (!choice) {
            await interaction.reply({ content: `⚠️ Unknown selection. Please try again.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        const roleIdIsValid = typeof choice.id === 'string' && /^\d{17,20}$/.test(choice.id);
        const resolvedRole = choice.resolvedRole;

        if (!roleIdIsValid && !resolvedRole) {
            await interaction.reply({ content: `⚠️ Role ID for this option is not configured. Please notify an administrator.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        if (!resolvedRole) {
            await interaction.reply({ content: `⚠️ The configured role could not be found in this server. Please notify an administrator.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);

        const guildRoleId = resolvedRole.id;

        // Get all other role IDs in this category to remove them
        const siblingRoleIds = resolvedChoices
            .filter(opt => opt.key !== choice.key && opt.resolvedRole && opt.resolvedRole.id !== guildRoleId)
            .map(opt => opt.resolvedRole.id)
            .filter(id => typeof id === 'string');

        const rolesToRemove = member.roles.cache.filter(role => siblingRoleIds.includes(role.id));

        try {
            if (rolesToRemove.size) {
                await member.roles.remove([...rolesToRemove.keys()]);
            }

            if (!member.roles.cache.has(guildRoleId)) {
                await member.roles.add(guildRoleId);
            }
        } catch (roleError) {
            console.error('[onboarding] Failed to update roles for selection:', roleError);
            await interaction.reply({ content: '⚠️ I could not update your roles. Please contact a moderator.', ephemeral: true });
            return true;
        }

        // Normalize storage key to the singular keys used by the button handler
        let storageKey;
        switch (categoryKey.toLowerCase()) {
            case 'pronouns':
            case 'pronoun':
                storageKey = 'pronoun';
                break;
            case 'timezone':
                storageKey = 'timezone';
                break;
            case 'what_interests_you_most':
                storageKey = 'interest';
                break;
            case 'are_you_an_adult':
                storageKey = 'adult';
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
            roleId: guildRoleId,
        });        // Debug: log stored selections for troubleshooting
        try {
            const debugSelections = getSelections(interaction.user.id);
            console.debug('[onboarding-debug] stored selections for', interaction.user.id, debugSelections);
        } catch (dbgErr) {
            console.error('[onboarding-debug] failed to read stored selections:', dbgErr);
        }

        // Acknowledge the select interaction and send a short ephemeral confirmation with guild info
        try {
            await interaction.deferUpdate();
            // send a short ephemeral follow-up so the user knows which guild this applied to
            await interaction.followUp({ content: `Selection saved — Guild: ${formatGuildInfo(interaction)}`, ephemeral: true });
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
    if (!interaction.isModalSubmit() || interaction.customId !== VERIFICATION_MODAL_ID) return false;
    if (!isGuildAllowed(interaction)) return false;

    try {
        const characterRaw = (interaction.fields.getTextInputValue('characterName') || '').trim();
        const codeRaw = (interaction.fields.getTextInputValue('guildCode') || '').trim();

        if (!characterRaw) {
            await interaction.reply({ content: `Please provide a character name to look up.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

        if (!codeRaw || !/^[A-Za-z0-9]{4}$/.test(codeRaw)) {
            await interaction.reply({ content: `Please provide the 4-character guild code found in the Guild Info next to the Discord invite (alphanumeric).\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
            return true;
        }

    // Lookup the character name in the configured guild roster
            const normalize = (s) => (s || '').toLowerCase().trim();
            const target = normalize(characterRaw);
            let foundMember = null;
            let roster = null;

            // 1. Try fetching the guild roster
            try {
                roster = await fetchGuildRoster();
                console.log(`[wowGuild] Fetched roster, entries=${Array.isArray(roster) ? roster.length : 'unknown'}`);
            } catch (rosterErr) {
                console.warn('[wowGuild] Roster fetch failed, will try direct character lookup:', rosterErr.message);
            }

            if (Array.isArray(roster)) {
                for (const m of roster) {
                    const charName = extractRosterCharacterName(m);
                    if (!charName) continue;
                    if (normalize(charName) === target) {
                        foundMember = m;
                        break;
                    }
                }
            }

            // 2. Fallback: Try fetching character profile directly if not found in roster
            if (!foundMember) {
                try {
                    console.log(`[wowGuild] Character '${characterRaw}' not found in roster (or roster failed). Trying direct profile lookup...`);
                    const charProfile = await fetchCharacterProfile(slugifyForApi(WOW_GUILD_REALM_SLUG), slugifyForApi(characterRaw));
                    
                    // Check if the character's guild matches our configured guild
                    // We compare slugs to be safe
                    const targetGuildSlug = slugifyForApi(WOW_GUILD_SLUG);
                    const charGuildName = charProfile.guild ? slugifyForApi(charProfile.guild.name) : '';
                    
                    if (charGuildName === targetGuildSlug) {
                        console.log(`[wowGuild] Direct profile lookup successful. Verified guild: ${charProfile.guild.name}`);
                        foundMember = {
                            character: {
                                name: charProfile.name,
                                level: charProfile.level,
                                character_class: charProfile.character_class,
                                faction: charProfile.faction,
                                realm: charProfile.realm,
                                guild: charProfile.guild
                            },
                            rank: 999 // Rank is not available in profile summary, using placeholder
                        };
                    } else {
                        console.warn(`[wowGuild] Direct profile lookup found character, but guild does not match. Expected: ${WOW_GUILD_SLUG}, Found: ${charProfile?.guild?.name}`);
                    }
                } catch (profileErr) {
                    console.warn('[wowGuild] Direct character lookup failed:', profileErr.message);
                }
            }

            // If we found a candidate member, ensure the provided guild code matches the expected one
            if (foundMember) {
                try {
                    const expectedCode = await getExpectedGuildCode(interaction);
                    if (!expectedCode) {
                        console.warn('[wowGuild] Expected guild code not found (no env and no message match)');
                        await interaction.reply({ content: `Guild verification code is not configured. Please contact an administrator.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
                        return true;
                    }

                    if (codeRaw.toLowerCase() !== expectedCode.toLowerCase()) {
                        await interaction.reply({ content: `The guild code you entered is incorrect. Please check the Guild Info next to the Discord invite and try again.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
                        return true;
                    }
                } catch (codeErr) {
                    console.error('[wowGuild] Error validating guild code:', codeErr);
                    await interaction.reply({ content: `There was an error validating the guild code. Please try again later.\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
                    return true;
                }
            }

            if (!foundMember) {
                // Build a short sample of roster names to help debugging
                let sampleNames = [];
                if (Array.isArray(roster)) {
                    for (const item of roster.slice(0, 20)) {
                        const n = extractRosterCharacterName(item);
                        if (n) sampleNames.push(n);
                    }
                }
                console.warn('[wowGuild] Character lookup failed. Sample roster names:', sampleNames.slice(0,10));
                const sampleText = sampleNames.length ? ` Sample names: ${sampleNames.slice(0,10).join(', ')}` : '';
                await interaction.reply({ content: `Character '${characterRaw}' was not found in the Dawnbound roster for realm '${WOW_GUILD_REALM_SLUG}'. Please verify the name and try again.${sampleText}\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
                return true;
            }

            // Build a lightweight characterData object similar to the profile endpoint for downstream code
            const characterData = {
                name: foundMember.character?.name || characterRaw,
                level: foundMember.character?.level ?? '—',
                character_class: foundMember.character?.character_class || null,
                faction: foundMember.character?.faction || null,
                realm: { name: foundMember.character?.realm?.name || WOW_GUILD_REALM_SLUG, slug: WOW_GUILD_REALM_SLUG },
                guild: { slug: WOW_GUILD_SLUG, name: WOW_GUILD_SLUG, realm: { slug: WOW_GUILD_REALM_SLUG } },
            };

            await sendGuildVerificationEmbed(interaction, characterData);

        const meta = getSelections(interaction.user.id);
        clearSelections(interaction.user.id);

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);

        if (member.roles.cache.has(GATE_ROLE_ID)) {
            try {
                await member.roles.remove(GATE_ROLE_ID);
                console.log(`[onboarding] Removed gate role from user ${interaction.user.id}`);
            } catch (error) {
                console.error(`[onboarding] Failed to remove gate role from user ${interaction.user.id}:`, error);
            }
        }

        // Try to set the member's nickname to their verified character name and add verified role
        try {
            const desiredNickRaw = (characterData.name || '').trim();
            const desiredNick = desiredNickRaw ? desiredNickRaw.substring(0, 32) : '';

            // Resolve bot's guild member representation
            const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(interaction.client.user.id).catch(() => null);

            console.log(`[onboarding] Nick change check: user=${interaction.user.id} currentNick=${member.nickname || ''} username=${member.user.username} desiredNick=${desiredNick}`);

            if (!desiredNick) {
                console.warn('[onboarding] Desired nickname empty, skipping nickname change');
            } else if (!member.manageable) {
                console.warn(`[onboarding] Cannot change nickname for ${interaction.user.id}: member.manageable=false`);
            } else {
                try {
                    // Ensure bot's role is higher than the target member's highest role if we can determine positions
                    const botHighestPos = botMember && botMember.roles && botMember.roles.highest ? botMember.roles.highest.position : null;
                    const memberHighestPos = member.roles && member.roles.highest ? member.roles.highest.position : null;

                    if (botHighestPos !== null && memberHighestPos !== null && botHighestPos <= memberHighestPos) {
                        console.warn(`[onboarding] Cannot change nickname: bot role position (${botHighestPos}) <= member highest role position (${memberHighestPos})`);
                    } else {
                        if ((member.nickname || member.user.username) !== desiredNick) {
                            await member.setNickname(desiredNick, 'WoW guild verification');
                            console.log(`[onboarding] Set nickname for user ${interaction.user.id} -> ${desiredNick}`);
                        }
                    }
                } catch (cmpErr) {
                    // Fallback: attempt to set nickname if manageable
                    if ((member.nickname || member.user.username) !== desiredNick) {
                        await member.setNickname(desiredNick, 'WoW guild verification');
                        console.log(`[onboarding] Set nickname for user ${interaction.user.id} -> ${desiredNick} (fallback)`);
                    }
                }
            }

            // Add the verified WoW role to the member (if configured)
            if (WOW_VERIFIED_ROLE_ID) {
                // Ensure bot can manage roles: bot role must be higher than the role being added
                let canManageRole = true;
                if (botMember && botMember.roles && botMember.roles.highest) {
                    const roleToAdd = interaction.guild.roles.cache.get(WOW_VERIFIED_ROLE_ID) || await interaction.guild.roles.fetch(WOW_VERIFIED_ROLE_ID).catch(() => null);
                    if (roleToAdd && roleToAdd.position >= botMember.roles.highest.position) {
                        canManageRole = false;
                        console.warn(`[onboarding] Cannot add role ${WOW_VERIFIED_ROLE_ID}: bot's highest role position (${botMember.roles.highest.position}) is not higher than role position (${roleToAdd.position})`);
                    }
                }

                if (canManageRole && !member.roles.cache.has(WOW_VERIFIED_ROLE_ID)) {
                    await member.roles.add(WOW_VERIFIED_ROLE_ID, 'Verified WoW guild member');
                    console.log(`[onboarding] Added verified role ${WOW_VERIFIED_ROLE_ID} to user ${interaction.user.id}`);
                }
            }
        } catch (errManage) {
            console.error('[onboarding] Failed to set nickname or add verified role:', errManage);
        }

        const pronounLabel = meta.pronoun?.label || meta.pronoun?.name || 'your pronouns';
        const timezoneLabel = meta.timezone?.label || meta.timezone?.name;
        const interestLabel = meta.interest?.label || meta.interest?.name;
        const adultLabel = meta.adult?.label || meta.adult?.name;

        const summaryParts = [`Preferred pronouns: **${pronounLabel}**`];
        if (timezoneLabel) {
            summaryParts.push(`Timezone: **${timezoneLabel}**`);
        }
        if (interestLabel) {
            summaryParts.push(`Interests: **${interestLabel}**`);
        }
        if (adultLabel) {
            summaryParts.push(`Age confirmation: **${adultLabel}**`);
        }

        const summary = summaryParts.join('\n');

        // Send welcome messages to a dedicated welcome channel and an embed to the welcome-crew channel
        (async () => {
            try {
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
                const msg = `[OB 4/4 ] **Onboarding Completed (WoW)** ${memberForLog ? memberForLog.toString() : `<@${interaction.user.id}>`} | UserID: ${interaction.user.id} | <t:${Math.floor(accountCreatedTs/1000)}:R> | Roles = ${roleNames.length ? roleNames.join(', ') : 'none'} | Pronoun=${pronounLabelLog}`;
                await logChannel.send({ content: msg }).catch(() => null);
            }
        } catch (logErr) {
            console.error('[onboarding] Failed to send onboarding success log:', logErr);
        }

        await interaction.reply({
            content: `✅ ${characterData.name} verified as a member of Dawnbound! Welcome aboard!\n${summary}\n\nGuild: ${formatGuildInfo(interaction)}`,
            ephemeral: true,
        });
        return true;

    } catch (err) {
        console.error('[onboarding] handleModal error:', err);
        let reason = 'There was an error verifying your character. Please try again later.';
        if (err?.response?.status === 404) {
            reason = `Character not found on the Blizzard API. Please verify:\n• Realm is spelled correctly (e.g., "Moon Guard" or "Thrall")\n• Character name matches exactly as it appears in-game\n• Character exists on a North American realm`;
        } else if (err?.response?.status === 401 || err?.response?.status === 403) {
            reason = 'Unable to reach the Blizzard API with the configured credentials. Please contact an administrator.';
        }
        await interaction.reply({ content: `❌ ${reason}\n\nGuild: ${formatGuildInfo(interaction)}`, ephemeral: true });
        return true;
    }
}

function slugifyForApi(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

async function getBlizzardAccessToken() {
    const now = Date.now();
    if (blizzardTokenCache.token && blizzardTokenCache.expiresAt > now + 60000) {
        return blizzardTokenCache.token;
    }

    const clientId = process.env.BNET_CLIENT_ID;
    const clientSecret = process.env.BNET_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('Missing Battle.net client credentials');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await axios.post('https://us.battle.net/oauth/token', 'grant_type=client_credentials', {
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });

    const { access_token, expires_in } = response.data || {};
    if (!access_token) {
        throw new Error('Unable to obtain Blizzard API token');
    }

    blizzardTokenCache.token = access_token;
    blizzardTokenCache.expiresAt = Date.now() + ((expires_in || 3600) * 1000);
    return access_token;
}

async function fetchGuildRoster() {
    const token = await getBlizzardAccessToken();
    // Use the data API roster endpoint for the configured guild on the configured realm
    // Ensure slugs are properly formatted (lowercase, hyphens) to avoid 404s from minor typos
    const realmSlug = slugifyForApi(WOW_GUILD_REALM_SLUG);
    const guildSlug = slugifyForApi(WOW_GUILD_SLUG);

    const url = `https://${WOW_REGION}.api.blizzard.com/data/wow/guild/${realmSlug}/${guildSlug}/roster`;
    console.log(`[wowGuild] Guild roster URL: ${url}`);

    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        params: {
            namespace: WOW_NAMESPACE,
            locale: WOW_LOCALE,
        },
    });

    // The roster payload may place members under response.data?.members or response.data?.entries
    const data = response.data || {};
    if (Array.isArray(data.members)) return data.members;
    if (Array.isArray(data.entries)) return data.entries;
    // fallback: return the raw object for caller to inspect
    return data;
}

/**
 * Extract a character name from a roster entry using common shapes.
 * Returns null if no candidate name found.
 */
function extractRosterCharacterName(entry) {
    if (!entry || typeof entry !== 'object') return null;

    // Common shapes: entry.character.name, entry.name, entry.characterName, entry.character?.character?.name
    try {
        if (entry.character && typeof entry.character.name === 'string') return entry.character.name;
        if (typeof entry.name === 'string') return entry.name;
        if (entry.character && entry.character.character && typeof entry.character.character.name === 'string') return entry.character.character.name;
        if (entry.character_name && typeof entry.character_name === 'string') return entry.character_name;

        // Fallback: search shallow for any 'name' string property (prefer deeper under character)
        if (entry.character && typeof entry.character === 'object') {
            for (const k of Object.keys(entry.character)) {
                const v = entry.character[k];
                if (typeof v === 'string' && k.toLowerCase().includes('name')) return v;
            }
        }

        for (const k of Object.keys(entry)) {
            const v = entry[k];
            if (typeof v === 'string' && k.toLowerCase().includes('name')) return v;
        }
    } catch (e) {
        // ignore and return null
    }
    return null;
}

async function fetchCharacterProfile(realmSlug, characterSlug) {
    const token = await getBlizzardAccessToken();
    const url = `https://${WOW_REGION}.api.blizzard.com/profile/wow/character/${realmSlug}/${characterSlug}`;
    
    console.log(`[wowGuild] API Request URL: ${url}`);
    console.log(`[wowGuild] Realm slug: "${realmSlug}", Character slug: "${characterSlug}"`);
    
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        params: {
            namespace: WOW_NAMESPACE,
            locale: WOW_LOCALE,
        },
    });
    return response.data;
}

/**
 * Try to discover the expected 4-character guild code.
 * Priority:
 * 1. Environment variable WOW_ONBOARDING_CODE
 * 2. Search recent messages in the configured WOW_GUILD_LOG_CHANNEL_ID for a message containing 'invite' or 'guild info' and a 4-char code
 * Returns a lowercase string or null when not found.
 */
async function getExpectedGuildCode(interaction) {
    if (WOW_ONBOARDING_CODE && /^[A-Za-z0-9]{4}$/.test(WOW_ONBOARDING_CODE)) return WOW_ONBOARDING_CODE.toLowerCase();

    try {
        const channel = interaction.guild.channels.cache.get(WOW_GUILD_LOG_CHANNEL_ID)
            || await interaction.guild.channels.fetch(WOW_GUILD_LOG_CHANNEL_ID).catch(() => null);
        if (!channel || !channel.isText()) return null;

        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) return null;

        const codeRegex = /(?:invite|guild info|guild-info|discord invite)[^\n\r]{0,120}?([A-Za-z0-9]{4})/i;
        for (const m of messages.values()) {
            const text = (m.content || '').replace(/\s+/g, ' ');
            const match = text.match(codeRegex);
            if (match && match[1]) return match[1].toLowerCase();
        }

        // Fallback: find any 4-char token in messages that look likely to be a code
        const anyCode = /\b([A-Za-z0-9]{4})\b/;
        for (const m of messages.values()) {
            const text = (m.content || '').replace(/\s+/g, ' ');
            if (/guild info|invite|discord invite/i.test(text)) {
                const m2 = text.match(anyCode);
                if (m2 && m2[1]) return m2[1].toLowerCase();
            }
        }
    } catch (err) {
        console.warn('[wowGuild] getExpectedGuildCode error:', err && err.message ? err.message : err);
    }
    return null;
}

async function sendGuildVerificationEmbed(interaction, characterData) {
    try {
        const logChannel = interaction.guild.channels.cache.get(WOW_GUILD_LOG_CHANNEL_ID)
            || await interaction.guild.channels.fetch(WOW_GUILD_LOG_CHANNEL_ID).catch(() => null);
        if (!logChannel || !logChannel.send) return;

        const realmName = characterData.realm?.name || 'Unknown Realm';
        const guildRank = characterData.guild?.rank ?? 'Member';
        const hookEmbed = new EmbedBuilder()
            .setColor(0x00FF7F)
            .setTitle('WoW Guild Verification')
            .setDescription(`${interaction.user} verified **${characterData.name}** as a member of Dawnbound.`)
            .addFields(
                { name: 'Character', value: characterData.name, inline: true },
                { name: 'Realm', value: realmName, inline: true },
                { name: 'Level', value: `${characterData.level ?? '—'}`, inline: true },
                { name: 'Class', value: characterData.character_class?.name || 'Unknown', inline: true },
                { name: 'Faction', value: characterData.faction?.name || 'Unknown', inline: true },
                { name: 'Guild Rank', value: guildRank, inline: true },
            )
            .setTimestamp();

        await logChannel.send({ embeds: [hookEmbed] }).catch(() => null);
    } catch (err) {
        console.error('[onboarding] Failed to send WoW verification embed:', err);
    }
}

module.exports = {
    handleButton,
    handleSelect,
    handleModal,
    clearSelections,
    clearAllState,
    setSelection,
    getSelections,
    ONBOARDING_CATEGORIES,
    GATE_ROLE_ID,
    getCategoryByName,
    rateLimits: {
        button: 2000,
        select: 2000,
        modal: 5000,
    },
};

