/* Database Creation Commands */
/* This script will be run automatically by the PostgreSQL container on its first startup. */

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    cmd_prefix TEXT DEFAULT '!',
    bot_enabled BOOLEAN DEFAULT TRUE,
    bot_timezone TEXT DEFAULT 'UTC',
    plan_tier TEXT DEFAULT 'non_premium',
    enable_leveling BOOLEAN DEFAULT TRUE,
    enable_economy BOOLEAN DEFAULT TRUE,
    enable_role_menus BOOLEAN DEFAULT TRUE,
    auto_role_enabled BOOLEAN DEFAULT FALSE,
    auto_role_id TEXT,
    roles_super_admin TEXT DEFAULT '[]',
    roles_admin TEXT DEFAULT '[]',
    roles_mod TEXT DEFAULT '[]',
    roles_jr_mod TEXT DEFAULT '[]',
    roles_helper TEXT DEFAULT '[]',
    roles_trust TEXT DEFAULT '[]',
    roles_untrusted TEXT DEFAULT '[]',
    enable_automod BOOLEAN DEFAULT TRUE,
    enable_openAI BOOLEAN DEFAULT TRUE,
    mute_roleID TEXT,
    mute_rolesRemoved TEXT DEFAULT '[]',
    mute_immuneUserIDs TEXT DEFAULT '[]',
    kick_immuneRoles TEXT DEFAULT '[]',
    kick_immuneUserID TEXT DEFAULT '[]',
    ban_immuneRoles TEXT DEFAULT '[]',
    ban_immuneUserID TEXT DEFAULT '[]',
    ch_actionLog TEXT,
    enable_ch_actionLog BOOLEAN DEFAULT TRUE,
    ch_kickbanLog TEXT,
    enable_ch_kickbanLog BOOLEAN DEFAULT TRUE,
    ch_auditLog TEXT,
    enable_ch_auditLog BOOLEAN DEFAULT TRUE,
    ch_airlockJoin TEXT,
    enable_ch_airlockJoin BOOLEAN DEFAULT TRUE,
    ch_airlockLeave TEXT,
    enable_ch_airlockLeave BOOLEAN DEFAULT TRUE,
    ch_deletedMessages TEXT,
    enable_ch_deletedMessages BOOLEAN DEFAULT TRUE,
    ch_editedMessages TEXT,
    enable_ch_editedMessages BOOLEAN DEFAULT TRUE,
    ch_automod_AI TEXT,
    enable_ch_automod_AI BOOLEAN DEFAULT TRUE,
    ch_voiceLog TEXT,
    enable_ch_voiceLog BOOLEAN DEFAULT TRUE,
    ch_inviteLog TEXT,
    enable_ch_inviteLog BOOLEAN DEFAULT TRUE,
    ch_permanentInvites TEXT,
    enable_ch_permanentInvites BOOLEAN DEFAULT TRUE,
    ch_memberJoin TEXT,
    enable_ch_memberJoin BOOLEAN DEFAULT TRUE,
    ch_categoryIgnoreAutomod TEXT DEFAULT '[]',
    ch_channelIgnoreAutomod TEXT DEFAULT '[]'
);

-- ==================== COMMAND REGISTRY + PER-GUILD COMMAND TOGGLES ====================

CREATE TABLE IF NOT EXISTS command_registry (
    command_name TEXT PRIMARY KEY,
    category TEXT,
    has_slash BOOLEAN DEFAULT FALSE,
    has_prefix BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_command_settings (
    guild_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, command_name)
);

CREATE INDEX IF NOT EXISTS idx_guild_command_settings_guild
    ON guild_command_settings (guild_id);

-- ==================== DELETED MESSAGE AUDIT (FOR /deleted) ====================

CREATE TABLE IF NOT EXISTS deleted_messages (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deleted_messages_guild_user_time
    ON deleted_messages (guild_id, user_id, deleted_at DESC);

CREATE TABLE IF NOT EXISTS filtered_messages (
    fmsg_ID SERIAL PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    message_id TEXT,
    channel_id TEXT,
    timestamp TEXT,
    hate INTEGER,
    harassment INTEGER,
    self_harm INTEGER,
    sexual INTEGER,
    violence INTEGER,
    content TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS muted_users (
    mute_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    active BOOLEAN,
    reason TEXT,
    roles TEXT,
    actioned_by TEXT,
    length TEXT,
    expires TEXT,
    timestamp TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invite_log (
    log_id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT,
    utc_time TIMESTAMP NOT NULL,
    invite_code TEXT NOT NULL,
    invite_creator TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    max_uses INTEGER DEFAULT 0,
    temporary BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP,
    uses_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_info (
    instance SERIAL PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    messages TEXT,
    ai_hate INTEGER,
    ai_harassment INTEGER,
    ai_self_harm INTEGER,
    ai_sexual INTEGER,
    ai_violence INTEGER,
    safety_hate INTEGER,
    safety_sexual INTEGER,
    safety_topicsPolitical INTEGER,
    safety_topicsUncomfortable INTEGER,
    banned INTEGER,
    kicked INTEGER,
    warned INTEGER,
    muted INTEGER,
    timeout INTEGER,
    ignore BOOLEAN DEFAULT FALSE,
    timestamp TEXT
);

-- Economy table: stores wallet and bank balances per user per guild
CREATE TABLE IF NOT EXISTS guild_economy (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wallet BIGINT DEFAULT 0,
    bank BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_economy_guild
    ON guild_economy (guild_id);

CREATE INDEX IF NOT EXISTS idx_filtered_messages_guild_recorded_at
    ON filtered_messages (guild_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_muted_users_guild_active
    ON muted_users (guild_id, active);

CREATE INDEX IF NOT EXISTS idx_muted_users_active_expires_at
    ON muted_users (active, expires_at);

CREATE INDEX IF NOT EXISTS idx_invite_log_guild_created_at
    ON invite_log (guild_id, created_at);

-- ==================== ACTIVITY TRACKING TABLES ====================
-- These tables support dashboard analytics and charts

-- Guild events tracking (joins, leaves, messages)
CREATE TABLE IF NOT EXISTS guild_events (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    user_id TEXT,
    channel_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_events_guild_date ON guild_events(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_events_type ON guild_events(guild_id, event_type, created_at);

-- Moderation logs
CREATE TABLE IF NOT EXISTS moderation_logs (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_user_id TEXT,
    target_username TEXT,
    moderator_id TEXT,
    moderator_username TEXT,
    reason TEXT,
    duration_minutes INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_guild_date ON moderation_logs(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_type ON moderation_logs(guild_id, action_type, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_target ON moderation_logs(guild_id, target_user_id);

-- Member tracking for join/leave stats
CREATE TABLE IF NOT EXISTS member_tracking (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    invite_code TEXT,
    inviter_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_tracking_guild ON member_tracking(guild_id);
CREATE INDEX IF NOT EXISTS idx_member_tracking_user ON member_tracking(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_member_tracking_dates ON member_tracking(guild_id, joined_at, left_at);

-- Daily stats aggregation (for faster dashboard loading)
CREATE TABLE IF NOT EXISTS daily_stats (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    date DATE NOT NULL,
    joins_count INTEGER DEFAULT 0,
    leaves_count INTEGER DEFAULT 0,
    messages_count INTEGER DEFAULT 0,
    voice_minutes INTEGER DEFAULT 0,
    mod_actions_count INTEGER DEFAULT 0,
    captcha_kicks_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(guild_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_guild_date ON daily_stats(guild_id, date);
-- ==================== DASHBOARD AUTH TABLES ====================

CREATE TABLE IF NOT EXISTS dashboard_users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    discord_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES dashboard_users(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_token ON dashboard_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user ON dashboard_sessions(user_id);

-- ==================== AUTOMOD SETTINGS TABLES ====================

CREATE TABLE IF NOT EXISTS automod_no_roleplay (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    whitelisted_channels JSONB DEFAULT '[]',
    ignored_roles JSONB DEFAULT '[]',
    romantic_keywords TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automod_no_danger_edits (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    forbidden_words_regex TEXT,
    ignored_channels JSONB DEFAULT '[]',
    ignored_roles JSONB DEFAULT '[]',
    log_channel_id TEXT,
    ping_role_id TEXT,
    delete_message BOOLEAN DEFAULT TRUE,
    mute_user BOOLEAN DEFAULT TRUE,
    mute_duration_minutes INTEGER DEFAULT 60,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== REPLY THREAD SETTINGS TABLES ====================

CREATE TABLE IF NOT EXISTS reply_thread_settings (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    introduction_channel_id TEXT,
    debug_channel_id TEXT,
    dating_phrases_regex TEXT,
    dating_warning_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reply_thread_channels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, channel_id)
);

-- ==================== ONBOARDING SETTINGS TABLES ====================

CREATE TABLE IF NOT EXISTS onboarding_settings (
    guild_id TEXT PRIMARY KEY,
    gate_role_id TEXT,
    log_channel_id TEXT,
    welcome_channel_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_categories (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    channel_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_categories_guild ON onboarding_categories(guild_id);

CREATE TABLE IF NOT EXISTS onboarding_roles (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    category_id INTEGER REFERENCES onboarding_categories(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL,
    role_name TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_roles_guild ON onboarding_roles(guild_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_roles_category ON onboarding_roles(category_id);

-- ==================== WOW GUILD SETTINGS TABLES ====================

CREATE TABLE IF NOT EXISTS wow_guild_settings (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    onboarding_code TEXT,
    gate_role_id TEXT,
    wow_member_role_id TEXT,
    onboarding_channel_id TEXT,
    welcome_channel_id TEXT,
    log_channel_id TEXT,
    introduction_channel_id TEXT,
    welcome_message TEXT,
    code_prompt_message TEXT,
    invalid_code_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== WOW GUEST SETTINGS TABLES ====================

CREATE TABLE IF NOT EXISTS wow_guest_settings (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    gate_role_id TEXT,
    guest_role_id TEXT,
    onboarding_channel_id TEXT,
    welcome_channel_id TEXT,
    log_channel_id TEXT,
    introduction_channel_id TEXT,
    welcome_message TEXT,
    button_label TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== LEVELING SYSTEM TABLES ====================

CREATE TABLE IF NOT EXISTS member_leveling (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    msg_exp INTEGER DEFAULT 0,
    voice_exp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    last_msg_date TIMESTAMPTZ,
    firstName TEXT,
    lastName TEXT,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_activity_config (
    guild_id TEXT PRIMARY KEY,
    rolling_period_days INTEGER DEFAULT 30,
    anti_spam_level INTEGER DEFAULT 1,
    exclude_muted BOOLEAN DEFAULT TRUE,
    exclude_deafened BOOLEAN DEFAULT TRUE,
    exclude_bots BOOLEAN DEFAULT TRUE,
    excluded_message_channels TEXT[] DEFAULT '{}',
    excluded_voice_channels TEXT[] DEFAULT '{}',
    remove_previous_role BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leveling_roles (
    guild_id TEXT,
    role_id TEXT,
    msg_exp_requirement INTEGER DEFAULT 0,
    voice_exp_requirement INTEGER DEFAULT 0,
    logic_operator TEXT DEFAULT 'OR', -- 'AND', 'OR'
    rolling_period_days INTEGER DEFAULT 90,
    position INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, role_id)
);

-- ==================== MEMBER STATS TABLES ====================

CREATE TABLE IF NOT EXISTS member_daily_stats (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    stat_date DATE NOT NULL,
    message_count INTEGER DEFAULT 0,
    vc_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(guild_id, user_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_member_daily_stats_guild_date ON member_daily_stats(guild_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_member_daily_stats_user ON member_daily_stats(user_id);

-- ==================== DISCORD CACHE TABLES ====================
-- Used by dashboard to avoiding rapid API calls

CREATE TABLE IF NOT EXISTS discord_channels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    name TEXT,
    type INTEGER,
    position INTEGER,
    parent_id TEXT,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS discord_roles (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    name TEXT,
    color INTEGER,
    position INTEGER,
    permissions TEXT,
    managed BOOLEAN,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (guild_id, role_id)
);
