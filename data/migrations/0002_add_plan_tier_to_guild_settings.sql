-- 0002_add_plan_tier_to_guild_settings.sql
-- Ensure guild_settings has a plan_tier column referenced by retention code

ALTER TABLE guild_settings
  ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'non_premium';
