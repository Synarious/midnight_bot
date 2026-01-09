/**
 * Automod Settings Database Functions
 * Provides database access for all automod and feature configuration
 */

const { query, ensureSchemaReady } = require('./database');

// ==================== NO ROLEPLAY SETTINGS ====================

const noRoleplayCache = new Map();
const NO_ROLEPLAY_CACHE_TTL = 60000; // 1 minute

async function getNoRoleplaySettings(guildId) {
    await ensureSchemaReady();

    // Check cache first
    const cached = noRoleplayCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < NO_ROLEPLAY_CACHE_TTL) {
        return cached.data;
    }

    const { rows } = await query(
        'SELECT * FROM automod_no_roleplay WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getNoRoleplaySettings' }
    );

    const settings = rows[0] || null;
    noRoleplayCache.set(guildId, { data: settings, timestamp: Date.now() });
    return settings;
}

async function setNoRoleplaySettings(guildId, settings) {
    await ensureSchemaReady();

    const {
        enabled = true,
        romanticKeywords = 'cuddle|hug|kiss|nuzzle|wiggle|snuggle|purr|lick|blush',
        whitelistedChannels = [],
        ignoredRoles = []
    } = settings;

    await query(
        `INSERT INTO automod_no_roleplay (guild_id, enabled, romantic_keywords, whitelisted_channels, ignored_roles, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            romantic_keywords = EXCLUDED.romantic_keywords,
            whitelisted_channels = EXCLUDED.whitelisted_channels,
            ignored_roles = EXCLUDED.ignored_roles,
            updated_at = NOW()`,
        [guildId, enabled, romanticKeywords, JSON.stringify(whitelistedChannels), JSON.stringify(ignoredRoles)],
        { rateKey: guildId, context: 'setNoRoleplaySettings' }
    );

    noRoleplayCache.delete(guildId);
}

function invalidateNoRoleplayCache(guildId) {
    if (guildId) {
        noRoleplayCache.delete(guildId);
    } else {
        noRoleplayCache.clear();
    }
}

// ==================== NO DANGER EDITS SETTINGS ====================

const noDangerEditsCache = new Map();
const NO_DANGER_EDITS_CACHE_TTL = 60000;

async function getNoDangerEditsSettings(guildId) {
    await ensureSchemaReady();

    const cached = noDangerEditsCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < NO_DANGER_EDITS_CACHE_TTL) {
        return cached.data;
    }

    const { rows } = await query(
        'SELECT * FROM automod_no_danger_edits WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getNoDangerEditsSettings' }
    );

    const settings = rows[0] || null;
    noDangerEditsCache.set(guildId, { data: settings, timestamp: Date.now() });
    return settings;
}

async function setNoDangerEditsSettings(guildId, settings) {
    await ensureSchemaReady();

    const {
        enabled = true,
        forbiddenWordsRegex = '\\b(child|children|kid|kids|young|babies|baby|age|old|years|school|elementary|daycare)\\b',
        logChannelId = null,
        pingRoleId = null,
        ignoredChannels = [],
        ignoredRoles = []
    } = settings;

    await query(
        `INSERT INTO automod_no_danger_edits (guild_id, enabled, forbidden_words_regex, log_channel_id, ping_role_id, ignored_channels, ignored_roles, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            forbidden_words_regex = EXCLUDED.forbidden_words_regex,
            log_channel_id = EXCLUDED.log_channel_id,
            ping_role_id = EXCLUDED.ping_role_id,
            ignored_channels = EXCLUDED.ignored_channels,
            ignored_roles = EXCLUDED.ignored_roles,
            updated_at = NOW()`,
        [guildId, enabled, forbiddenWordsRegex, logChannelId, pingRoleId, JSON.stringify(ignoredChannels), JSON.stringify(ignoredRoles)],
        { rateKey: guildId, context: 'setNoDangerEditsSettings' }
    );

    noDangerEditsCache.delete(guildId);
}

function invalidateNoDangerEditsCache(guildId) {
    if (guildId) {
        noDangerEditsCache.delete(guildId);
    } else {
        noDangerEditsCache.clear();
    }
}

// ==================== REPLY THREAD SETTINGS ====================

const replyThreadCache = new Map();
const REPLY_THREAD_CACHE_TTL = 60000;

async function getReplyThreadSettings(guildId) {
    await ensureSchemaReady();

    const cached = replyThreadCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < REPLY_THREAD_CACHE_TTL) {
        return cached.data;
    }

    const { rows: settingsRows } = await query(
        'SELECT * FROM reply_thread_settings WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getReplyThreadSettings' }
    );

    const { rows: channelRows } = await query(
        'SELECT * FROM reply_thread_channels WHERE guild_id = $1 AND enabled = TRUE',
        [guildId],
        { rateKey: guildId, context: 'getReplyThreadChannels' }
    );

    const settings = settingsRows[0] || null;
    const channels = channelRows.reduce((acc, row) => {
        acc[row.channel_id] = { emoji: row.emoji, category: row.category };
        return acc;
    }, {});

    const data = settings ? { ...settings, channels } : null;
    replyThreadCache.set(guildId, { data, timestamp: Date.now() });
    return data;
}

async function setReplyThreadSettings(guildId, settings) {
    await ensureSchemaReady();

    const {
        enabled = true,
        introductionChannelId = null,
        debugChannelId = null,
        datingPhrasesRegex = '\\b(straight|sexuality|single|bisexual|lesbian)\\b'
    } = settings;

    await query(
        `INSERT INTO reply_thread_settings (guild_id, enabled, introduction_channel_id, debug_channel_id, dating_phrases_regex, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            introduction_channel_id = EXCLUDED.introduction_channel_id,
            debug_channel_id = EXCLUDED.debug_channel_id,
            dating_phrases_regex = EXCLUDED.dating_phrases_regex,
            updated_at = NOW()`,
        [guildId, enabled, introductionChannelId, debugChannelId, datingPhrasesRegex],
        { rateKey: guildId, context: 'setReplyThreadSettings' }
    );

    replyThreadCache.delete(guildId);
}

async function setReplyThreadChannel(guildId, channelId, config) {
    await ensureSchemaReady();

    const { emoji = '📌', category, enabled = true } = config;

    await query(
        `INSERT INTO reply_thread_channels (guild_id, channel_id, emoji, category, enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (guild_id, channel_id) DO UPDATE SET
            emoji = EXCLUDED.emoji,
            category = EXCLUDED.category,
            enabled = EXCLUDED.enabled,
            updated_at = NOW()`,
        [guildId, channelId, emoji, category, enabled],
        { rateKey: guildId, context: 'setReplyThreadChannel' }
    );

    replyThreadCache.delete(guildId);
}

async function deleteReplyThreadChannel(guildId, channelId) {
    await ensureSchemaReady();

    await query(
        'DELETE FROM reply_thread_channels WHERE guild_id = $1 AND channel_id = $2',
        [guildId, channelId],
        { rateKey: guildId, context: 'deleteReplyThreadChannel' }
    );

    replyThreadCache.delete(guildId);
}

async function getReplyThreadChannels(guildId) {
    await ensureSchemaReady();

    const { rows } = await query(
        'SELECT * FROM reply_thread_channels WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getReplyThreadChannels' }
    );

    return rows;
}

function invalidateReplyThreadCache(guildId) {
    if (guildId) {
        replyThreadCache.delete(guildId);
    } else {
        replyThreadCache.clear();
    }
}

// ==================== ONBOARDING SETTINGS ====================

const onboardingCache = new Map();
const ONBOARDING_CACHE_TTL = 60000;

async function getOnboardingSettings(guildId) {
    await ensureSchemaReady();

    const cached = onboardingCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < ONBOARDING_CACHE_TTL) {
        return cached.data;
    }

    const { rows: settingsRows } = await query(
        'SELECT * FROM onboarding_settings WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getOnboardingSettings' }
    );

    const { rows: categoryRows } = await query(
        'SELECT * FROM onboarding_categories WHERE guild_id = $1 AND enabled = TRUE ORDER BY sort_order',
        [guildId],
        { rateKey: guildId, context: 'getOnboardingCategories' }
    );

    const categoryIds = categoryRows.map(c => c.id);
    let roles = [];
    if (categoryIds.length > 0) {
        const { rows: roleRows } = await query(
            'SELECT * FROM onboarding_roles WHERE category_id = ANY($1) AND enabled = TRUE ORDER BY sort_order',
            [categoryIds],
            { rateKey: guildId, context: 'getOnboardingRoles' }
        );
        roles = roleRows;
    }

    const categories = categoryRows.map(cat => ({
        ...cat,
        roles: roles.filter(r => r.category_id === cat.id)
    }));

    const settings = settingsRows[0] || null;
    const data = {
        settings,
        categories
    };

    onboardingCache.set(guildId, { data, timestamp: Date.now() });
    return data;
}

async function setOnboardingSettings(guildId, settings) {
    await ensureSchemaReady();

    const { gateRoleId = null, enabled = true } = settings;

    await query(
        `INSERT INTO onboarding_settings (guild_id, gate_role_id, enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            gate_role_id = EXCLUDED.gate_role_id,
            enabled = EXCLUDED.enabled,
            updated_at = NOW()`,
        [guildId, gateRoleId, enabled],
        { rateKey: guildId, context: 'setOnboardingSettings' }
    );

    onboardingCache.delete(guildId);
}

async function createOnboardingCategory(guildId, category) {
    await ensureSchemaReady();

    const { name, description = '', emoji = '', selectionType = 'REQUIRED_ONE', sortOrder = 0, enabled = true } = category;

    const { rows } = await query(
        `INSERT INTO onboarding_categories (guild_id, name, description, emoji, selection_type, sort_order, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (guild_id, name) DO UPDATE SET
            description = EXCLUDED.description,
            emoji = EXCLUDED.emoji,
            selection_type = EXCLUDED.selection_type,
            sort_order = EXCLUDED.sort_order,
            enabled = EXCLUDED.enabled,
            updated_at = NOW()
         RETURNING id`,
        [guildId, name, description, emoji, selectionType, sortOrder, enabled],
        { rateKey: guildId, context: 'createOnboardingCategory' }
    );

    onboardingCache.delete(guildId);
    return rows[0];
}

async function deleteOnboardingCategory(guildId, categoryId) {
    await ensureSchemaReady();

    await query(
        'DELETE FROM onboarding_categories WHERE guild_id = $1 AND id = $2',
        [guildId, categoryId],
        { rateKey: guildId, context: 'deleteOnboardingCategory' }
    );

    onboardingCache.delete(guildId);
}

async function createOnboardingRole(guildId, role) {
    await ensureSchemaReady();

    const { categoryId, roleId, name, emoji = '', key, sortOrder = 0, enabled = true } = role;

    const { rows } = await query(
        `INSERT INTO onboarding_roles (guild_id, category_id, role_id, name, emoji, key, sort_order, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (guild_id, category_id, role_id) DO UPDATE SET
            name = EXCLUDED.name,
            emoji = EXCLUDED.emoji,
            key = EXCLUDED.key,
            sort_order = EXCLUDED.sort_order,
            enabled = EXCLUDED.enabled,
            updated_at = NOW()
         RETURNING id`,
        [guildId, categoryId, roleId, name, emoji, key, sortOrder, enabled],
        { rateKey: guildId, context: 'createOnboardingRole' }
    );

    onboardingCache.delete(guildId);
    return rows[0];
}

async function deleteOnboardingRole(guildId, roleId) {
    await ensureSchemaReady();

    await query(
        'DELETE FROM onboarding_roles WHERE guild_id = $1 AND id = $2',
        [guildId, roleId],
        { rateKey: guildId, context: 'deleteOnboardingRole' }
    );

    onboardingCache.delete(guildId);
}

async function getOnboardingCategories(guildId) {
    await ensureSchemaReady();

    const { rows } = await query(
        'SELECT * FROM onboarding_categories WHERE guild_id = $1 ORDER BY sort_order',
        [guildId],
        { rateKey: guildId, context: 'getOnboardingCategories' }
    );

    return rows;
}

async function getOnboardingRoles(guildId, categoryId) {
    await ensureSchemaReady();

    const { rows } = await query(
        'SELECT * FROM onboarding_roles WHERE guild_id = $1 AND category_id = $2 ORDER BY sort_order',
        [guildId, categoryId],
        { rateKey: guildId, context: 'getOnboardingRoles' }
    );

    return rows;
}

function invalidateOnboardingCache(guildId) {
    if (guildId) {
        onboardingCache.delete(guildId);
    } else {
        onboardingCache.clear();
    }
}

// ==================== WOW GUILD SETTINGS ====================

const wowGuildCache = new Map();
const WOW_GUILD_CACHE_TTL = 60000;

async function getWowGuildSettings(guildId) {
    await ensureSchemaReady();

    const cached = wowGuildCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < WOW_GUILD_CACHE_TTL) {
        return cached.data;
    }

    const { rows } = await query(
        'SELECT * FROM wow_guild_settings WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getWowGuildSettings' }
    );

    const settings = rows[0] || null;
    wowGuildCache.set(guildId, { data: settings, timestamp: Date.now() });
    return settings;
}

async function setWowGuildSettings(guildId, settings) {
    await ensureSchemaReady();

    const {
        enabled = true,
        gateRoleId = null,
        memberRoleId = null,
        welcomeChannelId = null,
        logChannelId = null,
        realmSlug = 'moon-guard',
        onboardingCode = 'GB16',
        welcomeMessages = []
    } = settings;

    await query(
        `INSERT INTO wow_guild_settings (guild_id, enabled, gate_role_id, member_role_id, welcome_channel_id, log_channel_id, realm_slug, onboarding_code, welcome_messages, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            gate_role_id = EXCLUDED.gate_role_id,
            member_role_id = EXCLUDED.member_role_id,
            welcome_channel_id = EXCLUDED.welcome_channel_id,
            log_channel_id = EXCLUDED.log_channel_id,
            realm_slug = EXCLUDED.realm_slug,
            onboarding_code = EXCLUDED.onboarding_code,
            welcome_messages = EXCLUDED.welcome_messages,
            updated_at = NOW()`,
        [guildId, enabled, gateRoleId, memberRoleId, welcomeChannelId, logChannelId, realmSlug, onboardingCode, JSON.stringify(welcomeMessages)],
        { rateKey: guildId, context: 'setWowGuildSettings' }
    );

    wowGuildCache.delete(guildId);
}

function invalidateWowGuildCache(guildId) {
    if (guildId) {
        wowGuildCache.delete(guildId);
    } else {
        wowGuildCache.clear();
    }
}

// ==================== WOW GUEST SETTINGS ====================

const wowGuestCache = new Map();
const WOW_GUEST_CACHE_TTL = 60000;

async function getWowGuestSettings(guildId) {
    await ensureSchemaReady();

    const cached = wowGuestCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < WOW_GUEST_CACHE_TTL) {
        return cached.data;
    }

    const { rows } = await query(
        'SELECT * FROM wow_guest_settings WHERE guild_id = $1',
        [guildId],
        { rateKey: guildId, context: 'getWowGuestSettings' }
    );

    const settings = rows[0] || null;
    wowGuestCache.set(guildId, { data: settings, timestamp: Date.now() });
    return settings;
}

async function setWowGuestSettings(guildId, settings) {
    await ensureSchemaReady();

    const {
        enabled = true,
        gateRoleId = null,
        guestRoleId = null,
        welcomeChannelId = null,
        logChannelId = null,
        welcomeMessages = []
    } = settings;

    await query(
        `INSERT INTO wow_guest_settings (guild_id, enabled, gate_role_id, guest_role_id, welcome_channel_id, log_channel_id, welcome_messages, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            gate_role_id = EXCLUDED.gate_role_id,
            guest_role_id = EXCLUDED.guest_role_id,
            welcome_channel_id = EXCLUDED.welcome_channel_id,
            log_channel_id = EXCLUDED.log_channel_id,
            welcome_messages = EXCLUDED.welcome_messages,
            updated_at = NOW()`,
        [guildId, enabled, gateRoleId, guestRoleId, welcomeChannelId, logChannelId, JSON.stringify(welcomeMessages)],
        { rateKey: guildId, context: 'setWowGuestSettings' }
    );

    wowGuestCache.delete(guildId);
}

function invalidateWowGuestCache(guildId) {
    if (guildId) {
        wowGuestCache.delete(guildId);
    } else {
        wowGuestCache.clear();
    }
}

// ==================== EXPORTS ====================

module.exports = {
    // No Roleplay
    getNoRoleplaySettings,
    setNoRoleplaySettings,
    invalidateNoRoleplayCache,

    // No Danger Edits
    getNoDangerEditsSettings,
    setNoDangerEditsSettings,
    invalidateNoDangerEditsCache,

    // Reply Thread
    getReplyThreadSettings,
    setReplyThreadSettings,
    setReplyThreadChannel,
    deleteReplyThreadChannel,
    getReplyThreadChannels,
    invalidateReplyThreadCache,

    // Onboarding
    getOnboardingSettings,
    setOnboardingSettings,
    createOnboardingCategory,
    deleteOnboardingCategory,
    createOnboardingRole,
    deleteOnboardingRole,
    getOnboardingCategories,
    getOnboardingRoles,
    invalidateOnboardingCache,

    // WoW Guild
    getWowGuildSettings,
    setWowGuildSettings,
    invalidateWowGuildCache,

    // WoW Guest
    getWowGuestSettings,
    setWowGuestSettings,
    invalidateWowGuestCache,
};
