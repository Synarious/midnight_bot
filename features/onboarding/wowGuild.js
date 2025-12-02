const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// ==================== ONBOARDING CONFIGURATION ====================
// Gate role that is removed when user completes verification
const GATE_ROLE_ID = '1442686627481911356';
const WOW_MEMBER_ROLE_ID = '1129313754778194050';
const WOW_WELCOME_CHANNEL_ID = '713412331761172506';
const WOW_LOG_CHANNEL_ID = '1443006368897306728';

// Blizzard (WoW) API configuration for Dawnbound verification
const WOW_REGION = 'us';
const WOW_NAMESPACE = 'profile-us';
const WOW_LOCALE = 'en_US';
// Guild/realm slugs can be overridden via env vars if you rename the guild or realm
const WOW_GUILD_SLUG = process.env.WOW_GUILD_SLUG || 'dawnbound';
const WOW_GUILD_REALM_SLUG = process.env.WOW_GUILD_REALM_SLUG || 'moon-guard';
const WOW_GUILD_LOG_CHANNEL_ID = '1443006368897306728';
const VERIFICATION_MODAL_ID = 'wow_guild_verification';

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

function getRandomWelcomeMessage(user) {
    const userMention = `<@${user.id}>`;
    const templates = [
        `Welcome ${userMention}! The Dawnbound gains a new champion — may your loot be plentiful.`,
        `Hey ${userMention}, fresh from Azeroth — may your quests be epic and your crits be high.`,
        `${userMention} has arrived at the guild hall — ready to queue for a dungeon?`,
        `Nice to see you ${userMention}! May your mounts be swift and your transmog legendary.`,
        `Welcome ${userMention}! Make yourself at the hearth — share your main and preferred spec when you can.`,
        `Hey ${userMention}, welcome aboard — hope you're ready for Mythic+ dungeons and world bosses.`,
        `Yo ${userMention}! Your avatar screams veteran — show us your best dungeon runs.`,
        `${userMention} — welcome! No need to introduce yourself, but let us know your class and role if you like.`,
        `Hi ${userMention}! That character name fits right in — may your runs be smooth.`,
        `Welcome ${userMention}! Quiet entry? Perfect — stealthy rogues and patient healers welcome.`,
        `Hey ${userMention}, glad you joined — bring potions and come dungeon night ready.`,
        `Welcome ${userMention}! If your name had a battlecry, we'd hear it across Azeroth.`,
        `Hi ${userMention}! Love the look — hope the Dawnbound feels like a second home.`,
        `Welcome ${userMention}! Your arrival strengthens our ranks — time for a dungeon push.`,
        `${userMention}, welcome! Whether you PvP, run dungeons, or collect mounts, you'll find allies here.`,
        `Hey ${userMention}, that avatar says "seasoned adventurer" — good to have you with us.`,
        `Welcome ${userMention}! No intro required, but drop your main and favourite dungeon if you want.`,
        `Nice to meet you ${userMention}! You look ready for heroic nights — enjoy the guild.`,
        `Welcome ${userMention}! If you want dungeon or gearing recs, ask any officer later.`,
        `Hey ${userMention}, subtle flex: great transmog. Welcome to the guild hall.`,
        `Welcome ${userMention}! Your name suggests a true looter — and we approve.`,
        `Hi ${userMention}! We appreciate a tasteful mount — swing by the tavern and say hi.`,
        `Welcome ${userMention}! Pop in when you feel like it — the guild hall's always open.`,
        `Hey ${userMention}, love the energy — ready for the next dungeon night?`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
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
        const modal = new ModalBuilder()
            .setCustomId(VERIFICATION_MODAL_ID)
            .setTitle('WoW Character Verification');

        const characterInput = new TextInputBuilder()
            .setCustomId('characterName')
            .setLabel('Character name')
            .setPlaceholder('Your WoW character name (this will become your nickname)')
            .setMinLength(2)
            .setMaxLength(32)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const codeInput = new TextInputBuilder()
            .setCustomId('guildCode')
            .setLabel('Member Code (4 characters)')
            .setPlaceholder(`Found within "Guild Info" in-game`)
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
 * Handle onboarding modal submission (character name verification)
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
            await interaction.reply({ content: 'Please provide a character name.', ephemeral: true });
            return true;
        }

        if (!codeRaw || !/^[A-Za-z0-9]{4}$/.test(codeRaw)) {
            await interaction.reply({ content: `Member code (found in guild info in-game)`, ephemeral: true });
            return true;
        }

        if (codeRaw.toLowerCase() !== WOW_ONBOARDING_CODE.toLowerCase()) {
            await interaction.reply({ content: `❌ Incorrect member code. Please try again with the correct code.`, ephemeral: true });
            return true;
        }

        await interaction.deferReply({ ephemeral: true });

        // Verify character exists in guild via API
        try {
            console.log(`[wowGuild] Verifying character '${characterRaw}' is in guild...`);
            
            // Fetch guild roster
            const roster = await fetchGuildRoster();
            const rosterMembers = Array.isArray(roster) ? roster : [];
            
            // Check if character exists in roster (case-insensitive)
            const characterNameLower = characterRaw.toLowerCase();
            const rosterCharNames = rosterMembers
                .map(entry => extractRosterCharacterName(entry))
                .filter(Boolean)
                .map(name => name.toLowerCase());
            
            console.log(`[wowGuild] Roster has ${rosterCharNames.length} members. Looking for '${characterNameLower}'.`);
            
            if (!rosterCharNames.includes(characterNameLower)) {
                console.warn(`[wowGuild] Character '${characterRaw}' NOT found in guild roster.`);
                await interaction.editReply({
                    content: `❌ Character **${characterRaw}** is not in the Dawnbound guild. Please verify your character name is correct.`,
                });
                return true;
            }
            
            // Also verify character profile exists via API
            const realmSlug = slugifyForApi(WOW_GUILD_REALM_SLUG);
            const characterSlug = slugifyForApi(characterRaw);
            const characterProfile = await fetchCharacterProfile(realmSlug, characterSlug);
            
            if (!characterProfile || !characterProfile.name) {
                console.warn(`[wowGuild] Character profile API failed for '${characterRaw}'.`);
                await interaction.editReply({
                    content: `❌ Could not verify character **${characterRaw}** on the API. Please ensure the character name is spelled correctly.`,
                });
                return true;
            }
            
            console.log(`[wowGuild] ✅ Character '${characterRaw}' verified in guild.`);
            
        } catch (apiErr) {
            console.error('[wowGuild] Character verification error:', apiErr);
            const errorMsg = apiErr.response?.status === 404 
                ? `❌ Character **${characterRaw}** not found on the ${WOW_REGION.toUpperCase()} region or not in Dawnbound.`
                : `❌ Error verifying character. Please try again later.`;
            await interaction.editReply({ content: errorMsg });
            return true;
        }

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        
        // Remove gate role
        const gateRoleId = GATE_ROLE_ID;
        if (gateRoleId && member.roles.cache.has(gateRoleId)) {
            try {
                await member.roles.remove(gateRoleId);
                console.log(`[wowGuild] Removed gate role ${gateRoleId} from ${interaction.user.tag}`);
            } catch (roleErr) {
                console.error('[wowGuild] Failed to remove gate role:', roleErr);
            }
        }

        // Set nickname to character name
        try {
            await member.setNickname(characterRaw);
            console.log(`[wowGuild] Set nickname to '${characterRaw}' for ${interaction.user.tag}`);
        } catch (nickErr) {
            console.error('[wowGuild] Failed to set nickname:', nickErr);
        }

        // Add WoW Member role
        if (WOW_MEMBER_ROLE_ID && !member.roles.cache.has(WOW_MEMBER_ROLE_ID)) {
            try {
                await member.roles.add(WOW_MEMBER_ROLE_ID);
                console.log(`[wowGuild] Added WoW Member role ${WOW_MEMBER_ROLE_ID} to ${interaction.user.tag}`);
            } catch (roleErr) {
                console.error('[wowGuild] Failed to add WoW Member role:', roleErr);
            }
        }

        // Send welcome message
        const welcomeChannelId = WOW_WELCOME_CHANNEL_ID;
        if (welcomeChannelId) {
            const welcomeChannel = interaction.guild.channels.cache.get(welcomeChannelId);
            if (welcomeChannel) {
                const welcomeMessage = getRandomWelcomeMessage(member.user);
                await welcomeChannel.send(welcomeMessage);
            }
        }

        // Log to WoW log channel
        const logChannelId = WOW_LOG_CHANNEL_ID;
        if (logChannelId) {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0x00FF7F)
                    .setTitle('✅ WoW Onboarding Completed')
                    .addFields(
                        { name: 'Discord Name', value: member.user.globalName || 'None', inline: true },
                        { name: 'Username', value: `@${member.user.username}`, inline: true },
                        { name: 'User ID', value: member.user.id, inline: true },
                        { name: 'Character Name', value: characterRaw, inline: true },
                        { name: 'Realm', value: WOW_GUILD_REALM_SLUG, inline: true },
                        { name: 'Member', value: member.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
        }

        await interaction.editReply({
            content: `✅ Welcome to the guild, **${characterRaw}**! Your nickname has been set and you now have access to the server.`,
        });

        return true;

    } catch (err) {
        console.error('[onboarding] handleModal error:', err);
        await interaction.reply({ content: '❌ There was an error processing your character name. Please try again.', ephemeral: true }).catch(() => 
            interaction.editReply({ content: '❌ There was an error processing your character name. Please try again.' }).catch(() => null)
        );
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
    handleModal,
    GATE_ROLE_ID,
    rateLimits: {
        button: 2000,
        modal: 5000,
    },
};

