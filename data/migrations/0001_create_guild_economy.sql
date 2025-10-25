-- 0001_create_guild_economy.sql
-- Create the guild_economy table if it does not already exist

CREATE TABLE IF NOT EXISTS guild_economy (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wallet BIGINT DEFAULT 0,
  bank BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_economy_guild ON guild_economy (guild_id);
