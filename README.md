## Database service overview

The bot now centralises all PostgreSQL access through `data/database.js`. The service applies migrations on startup, enforces rate limits, and runs scheduled data-retention sweeps that keep storage bounded as the bot scales across hundreds of guilds.

### Migrations

Run migrations whenever you deploy or pull schema changes:

```bash
npm run migrate
```

### Rate limiting

- **Global bucket** – `DB_GLOBAL_RATE_LIMIT` operations per `DB_RATE_LIMIT_INTERVAL_MS` (defaults: 5000 ops/minute).
- **Per-guild bucket** – `DB_GUILD_RATE_LIMIT` operations per interval (default: 500 ops/minute/guild).
- Logs include the guild identifier, limiter name, and retry-after window when a rate limit is triggered.

You can adjust limits with environment variables:

| Environment variable | Default | Description |
| --- | --- | --- |
| `DB_RATE_LIMIT_INTERVAL_MS` | `60000` | Interval, in ms, for bucket refills. |
| `DB_GLOBAL_RATE_LIMIT` | `5000` | Max operations per interval across all guilds. |
| `DB_GUILD_RATE_LIMIT` | `500` | Max operations per interval per guild. |

### Data retention tiers

Guilds are assigned a `plan_tier` in `guild_settings` (`non_premium`, `premium`, or `premium_plus`). Each tier enables an automated data-retention window:

| Tier | Default retention | Env override |
| --- | --- | --- |
| `non_premium` | 24 hours | `DB_RETENTION_NON_PREMIUM_SECONDS` |
| `premium` | 30 days | `DB_RETENTION_PREMIUM_SECONDS` |
| `premium_plus` | 180 days | `DB_RETENTION_PREMIUM_PLUS_SECONDS` |

The retention scheduler runs hourly (configurable via `DB_RETENTION_SWEEP_INTERVAL_MS`, minimum 5 minutes) and prunes:

- `filtered_messages` (using the new `recorded_at` column)
- `muted_users`
- `invite_log`

Use the exported helpers to work with tiers:

- `setGuildPlanTier(guildId, planTier)` – assign a tier.
- `getGuildRetentionPolicy(guildId)` – inspect the applied retention window.

All tiers can be managed programmatically and are safe for 1000+ guilds thanks to advisory locking, shard-aware rate limiting, and automatic pruning.
# Midnight Bot

Midnight Bot is a multi-guild Discord moderation and utility bot built with Discord.js v14 and PostgreSQL. The bot now ships with a hardened database service that provides automatic migrations, per-guild rate limiting, structured logging, and a lightweight cache for high-frequency lookups.

## Getting Started

1. Copy `example.env` to `.env` and fill in your Discord and PostgreSQL credentials. Ensure the Postgres port, host, and user values match `docker-compose.yml` if you use Docker.
2. Install dependencies:
	```bash
	npm install
	```
3. Apply database migrations before running the bot:
	```bash
	npm run migrate
	```
4. Launch the bot:
	```bash
	npm start
	```

> **Tip:** The migration runner acquires a Postgres advisory lock to prevent duplicate execution. It is safe to run more than once; only new migrations are applied.

## Database Layer Highlights

- **Automatic migrations** – SQL files in `data/migrations/` are executed in order. Checksums are verified to catch accidental edits.
- **Token bucket rate limiting** – The query wrapper enforces global and per-guild limits to protect the database from spikes.
- **Structured logging** – Adjustable verbosity via `DB_LOG_LEVEL`. Slow queries are surfaced when they exceed the configured threshold.
- **Hot cache** – Frequently accessed guild settings are cached with a configurable TTL to cut down on read load.
- **Safe settings updates** – Only whitelisted columns can be changed via `updateGuildSetting`, guarding against injection and schema drift.

## Environment Variables

Alongside the existing Postgres credentials (host, port, database, user, password) you can optionally tune the service with these keys:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_LOG_LEVEL` | `info` | One of `error`, `warn`, `info`, `debug`.
| `DB_GUILD_CACHE_TTL_MS` | `180000` | Guild settings cache TTL in milliseconds.
| `DB_GUILD_CACHE_MAX` | `5000` | Maximum cached guild entries.
| `DB_RATE_LIMIT_INTERVAL_MS` | `60000` | Window size for token bucket refill.
| `DB_GLOBAL_RATE_LIMIT` | `5000` | Tokens per interval for global queries.
| `DB_GUILD_RATE_LIMIT` | `500` | Tokens per interval for per-guild queries.
| `DB_RATE_LIMIT_BUCKET_TTL_MS` | `600000` | How long idle rate-limit buckets are kept before pruning (ms).
| `DB_RATE_LIMIT_MAX_GUILD_BUCKETS` | `50000` | Maximum guild buckets retained in memory for rate limiting.
| `DB_RATE_LIMIT_MAX_GLOBAL_BUCKETS` | `128` | Maximum buckets retained for the global limiter (match shard count when horizontal).
| `DB_RATE_LIMIT_INSTANCE_COUNT` | `1` | Divide limiter capacity across this many bot instances.
| `DB_SYNC_GUILD_BATCH_SIZE` | `500` | Guild insert batch size used during startup synchronization.
| `DB_SLOW_QUERY_THRESHOLD_MS` | `750` | Slow query warning threshold.

Adjust these values in `.env` if you need tighter controls or more aggressive logging.

## Maintenance & Backups

- Use `npm run migrate` after pulling updates to keep the schema current.
- `modules/dbBackup.js` continues to create timestamped SQL dumps in `data/backup/`. Ensure `BOT_OWNER_ID` is specified so scheduled backups can report issues.

## Contributing

1. Fork and clone the repository.
2. Create a feature branch.
3. Ensure `npm run migrate` succeeds and the bot starts locally.
4. Submit a pull request describing your changes and any new migrations.

Happy building!
