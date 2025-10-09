/* Database Creation Commands */
/* This script will be run automatically by the PostgreSQL container on its first startup. */

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    cmd_prefix TEXT DEFAULT '!',
    bot_enabled BOOLEAN DEFAULT TRUE,
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
    ch_kickbanLog TEXT,
    ch_auditLog TEXT,
    ch_airlockJoin TEXT,
    ch_airlockLeave TEXT,
    ch_deletedMessages TEXT,
    ch_editedMessages TEXT,
    ch_automod_AI TEXT,
    ch_voiceLog TEXT,
    ch_categoryIgnoreAutomod TEXT DEFAULT '[]',
    ch_channelIgnoreAutomod TEXT DEFAULT '[]'
);

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

CREATE INDEX IF NOT EXISTS idx_filtered_messages_guild_recorded_at
    ON filtered_messages (guild_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_muted_users_guild_active
    ON muted_users (guild_id, active);

CREATE INDEX IF NOT EXISTS idx_muted_users_active_expires_at
    ON muted_users (active, expires_at);

CREATE INDEX IF NOT EXISTS idx_invite_log_guild_created_at
    ON invite_log (guild_id, created_at);