require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_KEY = 872341;

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[(process.env.DB_LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;

const VALID_PLAN_TIERS = new Set(['non_premium', 'premium', 'premium_plus']);

const DEFAULT_RETENTION_WINDOWS_SECONDS = Object.freeze({
  non_premium: 24 * 60 * 60,
  premium: 30 * 24 * 60 * 60,
  premium_plus: 180 * 24 * 60 * 60,
});

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { message: value.message, code: value.code };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 2) return `[Array(${value.length})]`;
    return value.slice(0, 10).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 2) return '[Object]';
    const entries = Object.entries(value)
      .slice(0, 10)
      .map(([key, val]) => [key, sanitizeValue(val, depth + 1)]);
    return Object.fromEntries(entries);
  }
  return String(value);
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return meta;
  }
  return sanitizeValue(meta);
}

function log(level, message, meta) {
  const levelValue = LOG_LEVELS[level];
  if (levelValue === undefined || levelValue > CURRENT_LOG_LEVEL) {
    return;
  }
  if (meta) {
    console.log(`[DB][${level.toUpperCase()}] ${message}`, sanitizeMeta(meta));
  } else {
    console.log(`[DB][${level.toUpperCase()}] ${message}`);
  }
}

function secondsToIntervalLiteral(seconds) {
  const safeSeconds = Math.max(1, seconds | 0);
  return `${safeSeconds} seconds`;
}

function resolveRetentionSecondsFromEnv(envKey, defaultSeconds) {
  const candidate = process.env[envKey];
  if (!candidate) return defaultSeconds;
  const parsed = Number.parseInt(candidate, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    log('warn', `Invalid retention override for ${envKey}. Falling back to default.`, { value: candidate });
    return defaultSeconds;
  }
  return parsed;
}

function resolveIntegerFromEnv(envKey, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, allowZero = false } = {}) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    log('warn', `Invalid integer override for ${envKey}. Using fallback instead.`, { value: raw, fallback });
    return fallback;
  }

  if (allowZero && parsed === 0) {
    return 0;
  }

  if (!allowZero && parsed === 0) {
    log('warn', `Zero is not allowed for ${envKey}. Using fallback instead.`, { value: raw, fallback });
    return fallback;
  }

  if (!allowZero && parsed < 0 && min >= 0) {
    log('warn', `Negative value not allowed for ${envKey}. Using fallback instead.`, { value: raw, fallback });
    return fallback;
  }

  if (parsed < min || parsed > max) {
    log('warn', `Value for ${envKey} outside supported range. Using fallback instead.`, { value: raw, fallback, min, max });
    return fallback;
  }

  return parsed;
}

class TokenBucketRateLimiter {
  constructor({ capacity, refillAmount, refillIntervalMs, name, entryTtlMs, maxEntries }) {
    this.capacity = Math.max(1, capacity);
    this.refillAmount = Math.max(1, refillAmount);
    this.refillIntervalMs = Math.max(1, refillIntervalMs);
    this.name = name || 'rate-limiter';
    this.buckets = new Map();
    const defaultEntryTtl = Math.max(this.refillIntervalMs, this.refillIntervalMs * 10);
    this.entryTtlMs = Math.max(this.refillIntervalMs, entryTtlMs ?? defaultEntryTtl);
    this.maxEntries = Math.max(1, maxEntries ?? 5000);
    this.lastCleanup = 0;
  }

  consume(key = 'default', tokens = 1) {
    const now = Date.now();
    const bucketKey = key ?? 'default';
    this._pruneExpired(now);

    let entry = this.buckets.get(bucketKey);

    if (entry && now - entry.lastAccess > this.entryTtlMs) {
      this.buckets.delete(bucketKey);
      entry = null;
    }

    if (!entry) {
      entry = { tokens: this.capacity, lastRefill: now, lastAccess: now };
      this.buckets.set(bucketKey, entry);
    } else {
      entry.lastAccess = now;
    }

    if (now > entry.lastRefill) {
      const elapsed = now - entry.lastRefill;
      const refillCycles = Math.floor(elapsed / this.refillIntervalMs);
      if (refillCycles > 0) {
        const replenished = refillCycles * this.refillAmount;
        entry.tokens = Math.min(this.capacity, entry.tokens + replenished);
        entry.lastRefill += refillCycles * this.refillIntervalMs;
      }
    }

    if (entry.tokens < tokens) {
      const deficit = tokens - entry.tokens;
      const cyclesNeeded = Math.max(1, Math.ceil(deficit / this.refillAmount));
      const retryAfterMs = cyclesNeeded * this.refillIntervalMs;

      const error = new Error(`Rate limit exceeded for ${this.name}:${bucketKey}`);
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.retryAfterMs = retryAfterMs;
      error.meta = {
        limiter: this.name,
        key: bucketKey,
        capacity: this.capacity,
        availableTokens: entry.tokens,
        requestedTokens: tokens,
        refillAmount: this.refillAmount,
        refillIntervalMs: this.refillIntervalMs,
      };
      throw error;
    }

    entry.tokens -= tokens;
    return entry.tokens;
  }

  _pruneExpired(now) {
    if (now - this.lastCleanup < this.refillIntervalMs) {
      return;
    }

    this.lastCleanup = now;

    const expiryThreshold = now - this.entryTtlMs;
    for (const [bucketKey, entry] of this.buckets) {
      if (entry.lastAccess !== undefined && entry.lastAccess < expiryThreshold) {
        this.buckets.delete(bucketKey);
      }
    }

    if (this.buckets.size > this.maxEntries) {
      const iterator = this.buckets.keys();
      while (this.buckets.size > this.maxEntries) {
        const next = iterator.next();
        if (next.done) {
          break;
        }
        this.buckets.delete(next.value);
      }
    }
  }

  reset(key) {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }
}

class TTLCache {
  constructor(ttlMs, maxSize) {
    this.ttlMs = Math.max(1000, ttlMs);
    this.maxSize = Math.max(10, maxSize);
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (value === undefined) {
      this.delete(key);
      return;
    }
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

class DatabaseService {
  constructor() {
    this.config = this.buildPoolConfig();
    this.pool = new Pool(this.config);
    this.pool.on('error', (err) => {
      log('error', 'Unexpected error on idle PostgreSQL client', { error: err.message });
    });

    const guildCacheTtlMs = resolveIntegerFromEnv('DB_GUILD_CACHE_TTL_MS', 180000, { min: 1000 });
    const guildCacheMax = resolveIntegerFromEnv('DB_GUILD_CACHE_MAX', 5000, { min: 10 });

    this.cache = {
      guildSettings: new TTLCache(guildCacheTtlMs, guildCacheMax),
    };

    const rateInterval = resolveIntegerFromEnv('DB_RATE_LIMIT_INTERVAL_MS', 60000, { min: 1000 });
    const globalLimit = resolveIntegerFromEnv('DB_GLOBAL_RATE_LIMIT', 5000, { min: 1 });
    const guildLimit = resolveIntegerFromEnv('DB_GUILD_RATE_LIMIT', 500, { min: 1 });
    const limiterInstanceCount = resolveIntegerFromEnv('DB_RATE_LIMIT_INSTANCE_COUNT', 1, { min: 1 });
    const scaledGlobalLimit = Math.max(1, Math.floor(globalLimit / limiterInstanceCount));
    const scaledGuildLimit = Math.max(1, Math.floor(guildLimit / limiterInstanceCount));
    const bucketTtlMs = resolveIntegerFromEnv('DB_RATE_LIMIT_BUCKET_TTL_MS', rateInterval * 10, {
      min: rateInterval,
    });
    const maxGuildBuckets = resolveIntegerFromEnv('DB_RATE_LIMIT_MAX_GUILD_BUCKETS', 50000, { min: 1000 });
    const maxGlobalBuckets = resolveIntegerFromEnv('DB_RATE_LIMIT_MAX_GLOBAL_BUCKETS', 128, { min: 1 });

    if (limiterInstanceCount > 1) {
      log('info', 'Scaling rate limiter capacity for multi-instance deployment', {
        instances: limiterInstanceCount,
        scaledGlobalLimit,
        scaledGuildLimit,
      });
    }

    this.globalLimiter = new TokenBucketRateLimiter({
      capacity: scaledGlobalLimit,
      refillAmount: scaledGlobalLimit,
      refillIntervalMs: rateInterval,
      name: 'global',
      entryTtlMs: bucketTtlMs,
      maxEntries: maxGlobalBuckets,
    });

    this.guildLimiter = new TokenBucketRateLimiter({
      capacity: scaledGuildLimit,
      refillAmount: scaledGuildLimit,
      refillIntervalMs: rateInterval,
      name: 'guild',
      entryTtlMs: bucketTtlMs,
      maxEntries: maxGuildBuckets,
    });

    this.slowQueryThresholdMs = resolveIntegerFromEnv('DB_SLOW_QUERY_THRESHOLD_MS', 750, { min: 50 });

    this.retentionPolicies = this.buildRetentionPolicies();
    const sweepIntervalCandidate = resolveIntegerFromEnv('DB_RETENTION_SWEEP_INTERVAL_MS', 60 * 60 * 1000, {
      min: 5 * 60 * 1000,
    });
    this.retentionSweepIntervalMs = Math.max(5 * 60 * 1000, sweepIntervalCandidate);
    this.retentionTimer = null;
    this.retentionRunning = false;

    this.readyPromise = null;
    this.migrationPromise = null;
    this.syncGuildBatchSize = resolveIntegerFromEnv('DB_SYNC_GUILD_BATCH_SIZE', 500, { min: 50 });
  }

  buildPoolConfig() {
    const sslEnabled = String(process.env.PGSSL || '').toLowerCase() === 'true';
    const port = resolveIntegerFromEnv('PGPORT', undefined, { min: 1 });
    const maxConnections = resolveIntegerFromEnv('PG_POOL_MAX', 20, { min: 1 });
    const idleTimeoutMs = resolveIntegerFromEnv('PG_IDLE_TIMEOUT_MS', 30000, { min: 1000, allowZero: true });
    const connectionTimeoutMs = resolveIntegerFromEnv('PG_CONNECTION_TIMEOUT_MS', 5000, { min: 100, allowZero: true });

    const config = {
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      max: maxConnections,
      idleTimeoutMillis: idleTimeoutMs,
      connectionTimeoutMillis: connectionTimeoutMs,
    };

    if (port !== undefined) {
      config.port = port;
    }

    if (sslEnabled) {
      config.ssl = {
        rejectUnauthorized: String(process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false',
      };
    }

    return config;
  }

  buildRetentionPolicies() {
    const policies = {
      non_premium: resolveRetentionSecondsFromEnv(
        'DB_RETENTION_NON_PREMIUM_SECONDS',
        DEFAULT_RETENTION_WINDOWS_SECONDS.non_premium
      ),
      premium: resolveRetentionSecondsFromEnv(
        'DB_RETENTION_PREMIUM_SECONDS',
        DEFAULT_RETENTION_WINDOWS_SECONDS.premium
      ),
      premium_plus: resolveRetentionSecondsFromEnv(
        'DB_RETENTION_PREMIUM_PLUS_SECONDS',
        DEFAULT_RETENTION_WINDOWS_SECONDS.premium_plus
      ),
    };

    return Object.freeze(policies);
  }

  getRetentionSecondsForTier(planTier) {
    if (planTier && this.retentionPolicies[planTier] !== undefined) {
      return this.retentionPolicies[planTier];
    }
    return this.retentionPolicies.non_premium;
  }

  async initialize() {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = (async () => {
      log('info', 'Initializing database service', {
        host: this.config.host,
        database: this.config.database,
        poolMax: this.config.max,
      });

      await this.runMigrations();

      this.startDataRetentionScheduler();

      log('info', 'Database service is ready');
    })();

    return this.readyPromise;
  }

  loadMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      return [];
    }

    return fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^\d+_.+\.sql$/i.test(file))
      .sort()
      .map((file) => {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        const checksum = crypto.createHash('sha256').update(sql).digest('hex');
        const id = file.replace(/\.sql$/i, '');
        const description = file
          .replace(/\.sql$/i, '')
          .split('_')
          .slice(1)
          .join(' ')
          .replace(/-/g, ' ') || id;

        return { id, description, sql, checksum, filePath };
      });
  }

  async runMigrations() {
    if (this.migrationPromise) {
      return this.migrationPromise;
    }

    this.migrationPromise = this._runMigrationsInternal();
    try {
      await this.migrationPromise;
      this.cache.guildSettings.clear();
    } finally {
      this.migrationPromise = null;
    }
  }

  async _runMigrationsInternal() {
    const migrations = this.loadMigrationFiles();

    if (migrations.length === 0) {
      log('warn', 'No migration files found', { directory: MIGRATIONS_DIR });
      return;
    }

    const client = await this.pool.connect();
    let lockAcquired = false;

    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          description TEXT,
          executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      lockAcquired = true;

      const { rows: appliedRows } = await client.query('SELECT id, checksum FROM schema_migrations');
      const applied = new Map(appliedRows.map((row) => [row.id, row.checksum]));

      for (const migration of migrations) {
        if (applied.has(migration.id)) {
          const knownChecksum = applied.get(migration.id);
          if (knownChecksum !== migration.checksum) {
            throw new Error(
              `Checksum mismatch for migration ${migration.id}. Expected ${knownChecksum}, got ${migration.checksum}`
            );
          }
          continue;
        }

        log('info', `Applying migration ${migration.id}`, { file: path.basename(migration.filePath) });

        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (id, checksum, description) VALUES ($1, $2, $3)',
          [migration.id, migration.checksum, migration.description]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      log('error', 'Migration run failed', { error: error.message });
      throw error;
    } finally {
      if (lockAcquired) {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
        } catch (unlockError) {
          log('warn', 'Failed to release advisory lock', { error: unlockError.message });
        }
      }
      client.release();
    }
  }

  startDataRetentionScheduler() {
    if (this.retentionTimer || !this.retentionPolicies) {
      return;
    }

    const runSweep = async (trigger) => {
      if (this.retentionRunning) {
        return;
      }
      this.retentionRunning = true;
      try {
        await this.runDataRetentionSweep(trigger);
      } finally {
        this.retentionRunning = false;
      }
    };

    // Optionally run an initial sweep on startup. Some deployments prefer to avoid heavy
    // queries at startup (and avoid consuming DB rate-limiter tokens). Make this opt-in
    // via DB_RUN_RETENTION_ON_STARTUP=1. Default: do NOT run on startup.
    const runOnStartup = String(process.env.DB_RUN_RETENTION_ON_STARTUP || '0') === '1';
    if (runOnStartup) {
      runSweep('startup').catch((error) => {
        log('error', 'Initial data retention sweep failed', { error: error.message });
      });
    } else {
      log('info', 'Skipping initial data retention sweep (set DB_RUN_RETENTION_ON_STARTUP=1 to enable)');
    }

    // Schedule periodic sweeps
    this.retentionTimer = setInterval(() => {
      runSweep('interval').catch((error) => {
        log('error', 'Scheduled data retention sweep failed', { error: error.message });
      });
    }, this.retentionSweepIntervalMs);

    if (typeof this.retentionTimer.unref === 'function') {
      this.retentionTimer.unref();
    }
  }

  stopDataRetentionScheduler() {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  async runDataRetentionSweep(trigger = 'manual') {
    if (!this.pool) {
      return [];
    }

    const policies = Object.entries(this.retentionPolicies || {});
    if (policies.length === 0) {
      return [];
    }

    const client = await this.pool.connect();
    try {
      const results = [];
      for (const [plan, seconds] of policies) {
        const intervalLiteral = secondsToIntervalLiteral(seconds);

        const filtered = await client.query(
          `
          DELETE FROM filtered_messages fm
          USING guild_settings gs
          WHERE gs.guild_id = fm.guild_id
            AND gs.plan_tier = $1
            AND fm.recorded_at < NOW() - $2::interval
        `,
          [plan, intervalLiteral]
        );

        const invites = await client.query(
          `
          DELETE FROM invite_log il
          USING guild_settings gs
          WHERE gs.guild_id = il.guild_id
            AND gs.plan_tier = $1
            AND il.created_at < NOW() - $2::interval
        `,
          [plan, intervalLiteral]
        );

        const muted = await client.query(
          `
          DELETE FROM muted_users mu
          USING guild_settings gs
          WHERE gs.guild_id = mu.guild_id
            AND gs.plan_tier = $1
            AND mu.recorded_at < NOW() - $2::interval
        `,
          [plan, intervalLiteral]
        );

        results.push({
          plan,
          retentionSeconds: seconds,
          deleted: {
            filteredMessages: filtered.rowCount ?? 0,
            inviteLog: invites.rowCount ?? 0,
            mutedUsers: muted.rowCount ?? 0,
          },
        });
      }

      log('info', 'Data retention sweep completed', { trigger, results });
      return results;
    } catch (error) {
      log('error', 'Data retention sweep encountered an error', { trigger, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  _previewParams(params) {
    if (!Array.isArray(params)) return undefined;
    return params.slice(0, 10).map((value) => sanitizeValue(value));
  }

  _condenseSql(sql) {
    return sql.replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  async query(sql, params = [], options = {}) {
    await this.initialize();

    const {
      rateKey = null,
      guildId = null,
      tokens = 1,
      globalTokens = tokens,
      context = 'general',
      skipLogging = false,
    } = options;

    const perGuildKey = rateKey ?? guildId ?? null;
    const perGuildTokens = Math.max(1, Number(tokens) || 1);
    const globalBucketTokens = Math.max(1, Number(globalTokens) || perGuildTokens);

    try {
      this.globalLimiter.consume('global', globalBucketTokens);
      if (perGuildKey) {
        this.guildLimiter.consume(perGuildKey, perGuildTokens);
      }
    } catch (rateError) {
      log('warn', 'Database rate limit triggered', {
        context,
        guildId: perGuildKey,
        limiter: rateError.meta?.limiter,
        requestedTokens: rateError.meta?.requestedTokens ?? perGuildTokens,
        availableTokens: rateError.meta?.availableTokens,
        retryAfterMs: rateError.retryAfterMs,
      });
      throw rateError;
    }

    const start = performance.now();

    try {
      const result = await this.pool.query(sql, params);
      const durationMs = performance.now() - start;

      if (!skipLogging && CURRENT_LOG_LEVEL >= LOG_LEVELS.debug) {
        log('debug', `Query succeeded (${context})`, {
          durationMs: Number(durationMs.toFixed(2)),
          rowCount: result.rowCount,
          sql: this._condenseSql(sql),
          params: this._previewParams(params),
          guildId: perGuildKey,
        });
      } else if (durationMs > this.slowQueryThresholdMs) {
        log('warn', `Slow query detected (${context})`, {
          durationMs: Number(durationMs.toFixed(2)),
          sql: this._condenseSql(sql),
          guildId: perGuildKey,
        });
      }

      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      log('error', `Query failed (${context})`, {
        durationMs: Number(durationMs.toFixed(2)),
        sql: this._condenseSql(sql),
        params: this._previewParams(params),
        error: error.message,
        guildId: perGuildKey,
      });
      throw error;
    }
  }

  cacheGuildSettings(guildId, settings) {
    this.cache.guildSettings.set(guildId, settings ? Object.freeze({ ...settings }) : null);
  }

  getCachedGuildSettings(guildId) {
    return this.cache.guildSettings.get(guildId);
  }

  invalidateGuildSettings(guildId) {
    this.cache.guildSettings.delete(guildId);
  }

  async shutdown() {
    log('info', 'Shutting down database service');
    this.stopDataRetentionScheduler();
    await this.pool.end();
    this.cache.guildSettings.clear();
    this.readyPromise = null;
  }
}

const databaseService = new DatabaseService();

const updatableColumns = new Set([
  'cmd_prefix',
  'bot_enabled',
  'roles_super_admin',
  'roles_admin',
  'roles_mod',
  'roles_jr_mod',
  'roles_helper',
  'roles_trust',
  'roles_untrusted',
  'enable_automod',
  'enable_openAI',
  'mute_roleID',
  'mute_rolesRemoved',
  'mute_immuneUserIDs',
  'kick_immuneRoles',
  'kick_immuneUserID',
  'ban_immuneRoles',
  'ban_immuneUserID',
  'ch_actionLog',
  'ch_kickbanLog',
  'ch_auditLog',
  'ch_airlockJoin',
  'ch_airlockLeave',
  'ch_deletedMessages',
  'ch_editedMessages',
  'ch_automod_AI',
  'ch_voiceLog',
  'ch_categoryIgnoreAutomod',
  'ch_channelIgnoreAutomod',
  'ch_inviteLog',
  'ch_permanentInvites',
  'ch_memberJoin',
]);

async function ensureSchemaReady() {
  await databaseService.initialize();
}

async function updateGuildSetting(guildId, column, value) {
  await ensureSchemaReady();

  if (!updatableColumns.has(column)) {
    log('warn', 'Blocked attempt to update non-whitelisted column', { guildId, column });
    throw new Error('Invalid setting key.');
  }

  try {
    await databaseService.query(
      `
      INSERT INTO guild_settings (guild_id, ${column})
      VALUES ($1, $2)
      ON CONFLICT (guild_id)
      DO UPDATE SET ${column} = EXCLUDED.${column}
    `,
      [guildId, value],
      { rateKey: guildId, context: `updateGuildSetting:${column}` }
    );

    databaseService.invalidateGuildSettings(guildId);
    return true;
  } catch (error) {
    log('error', 'Failed to update guild setting', { guildId, column, error: error.message });
    return false;
  }
}

async function getGuildSettings(guildId) {
  await ensureSchemaReady();

  const cached = databaseService.getCachedGuildSettings(guildId);
  if (cached !== undefined) {
    return cached ? { ...cached } : null;
  }

  const { rows } = await databaseService.query(
    'SELECT * FROM guild_settings WHERE guild_id = $1',
    [guildId],
    { rateKey: guildId, context: 'getGuildSettings' }
  );

  const settings = rows[0] || null;

  if (!settings) {
    await databaseService.query(
      'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
      [guildId],
      { rateKey: guildId, context: 'ensureGuildSettingsRow', skipLogging: true }
    );
  }

  databaseService.cacheGuildSettings(guildId, settings);
  return settings ? { ...settings } : null;
}

async function getLogChannelId(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.ch_automod_ai ?? null;
}

async function getVoiceLogChannelId(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.ch_voicelog ?? null;
}

async function getJoinChannelId(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.ch_airlockjoin ?? null;
}

async function getLeaveChannelId(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.ch_airlockleave ?? null;
}

async function isOpenAIEnabled(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.enable_openai === true;
}

async function setLogChannelId(guildId, logChannelId) {
  await ensureSchemaReady();
  await databaseService.query(
    `
    INSERT INTO guild_settings (guild_id, ch_automod_AI)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET ch_automod_AI = EXCLUDED.ch_automod_AI
  `,
    [guildId, logChannelId],
    { rateKey: guildId, context: 'setLogChannelId' }
  );
  databaseService.invalidateGuildSettings(guildId);
}

async function setGuildPrefix(guildId, prefix) {
  await ensureSchemaReady();
  await databaseService.query(
    `
    INSERT INTO guild_settings (guild_id, cmd_prefix)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET cmd_prefix = EXCLUDED.cmd_prefix
  `,
    [guildId, prefix],
    { rateKey: guildId, context: 'setGuildPrefix' }
  );
  databaseService.invalidateGuildSettings(guildId);
}

async function filteringAI(guildId, userId, messageId, channelId, timestamp, userInfractions, content) {
  await ensureSchemaReady();
  let recordedAt;
  if (timestamp instanceof Date && !Number.isNaN(timestamp.getTime())) {
    recordedAt = new Date(timestamp.getTime());
  } else {
    const parsedTimestampMs = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
    recordedAt = Number.isNaN(parsedTimestampMs) ? new Date() : new Date(parsedTimestampMs);
  }

  await databaseService.query(
    `
    INSERT INTO filtered_messages (
      guild_id, user_id, message_id, channel_id, timestamp,
      hate, harassment, self_harm, sexual, violence, content, recorded_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `,
    [
      guildId,
      userId,
      messageId,
      channelId,
      timestamp,
      userInfractions.hate,
      userInfractions.harassment,
      userInfractions.self_harm,
      userInfractions.sexual,
      userInfractions.violence,
      content,
      recordedAt,
    ],
    { rateKey: guildId, context: 'filteringAI', tokens: 2 }
  );
}

function onGuildCreate(guild) {
  log('info', 'Joined new guild', { guildId: guild.id, name: guild.name });
}

function invalidateGuildSettingsCache(guildId) {
  if (!guildId) {
    return;
  }
  databaseService.invalidateGuildSettings(guildId);
}

async function syncGuildSettings(client) {
  await ensureSchemaReady();

  try {
    const botGuilds = client.guilds.cache.map((guild) => guild.id);
    if (botGuilds.length === 0) {
      log('info', 'No guilds cached for sync');
      return;
    }

    const { rows } = await databaseService.query(
      'SELECT guild_id FROM guild_settings WHERE guild_id = ANY($1::text[])',
      [botGuilds],
      { context: 'syncGuildSettings:existing' }
    );

    const existingGuilds = new Set(rows.map((row) => row.guild_id));
    const missingGuilds = botGuilds.filter((id) => !existingGuilds.has(id));

    if (missingGuilds.length === 0) {
      log('info', 'Guild settings already synchronized', { guildCount: botGuilds.length });
      return;
    }

    const batchSize = databaseService.syncGuildBatchSize || 500;
    for (let i = 0; i < missingGuilds.length; i += batchSize) {
      const chunk = missingGuilds.slice(i, i + batchSize);
      const placeholders = chunk.map((_, idx) => `($${idx + 1})`).join(', ');

      await databaseService.query(
        `INSERT INTO guild_settings (guild_id) VALUES ${placeholders} ON CONFLICT (guild_id) DO NOTHING`,
        chunk,
        { context: 'syncGuildSettings:insert', tokens: chunk.length }
      );
    }

    log('info', 'Synchronized guild settings', { inserted: missingGuilds.length, batches: Math.ceil(missingGuilds.length / batchSize) });
  } catch (error) {
    log('error', 'Guild settings sync failed', { error: error.message });
  }
}

async function getGuildPrefix(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.cmd_prefix ?? '!';
}

async function setRolePermissions(guildId, permissionType, roleIDs) {
  await ensureSchemaReady();

  const columnMap = {
    super_admin: 'roles_super_admin',
    admin: 'roles_admin',
    mod: 'roles_mod',
    jr_mod: 'roles_jr_mod',
    helper: 'roles_helper',
    trust: 'roles_trust',
    untrusted: 'roles_untrusted',
  };

  const column = columnMap[permissionType];
  if (!column) {
    throw new Error(`Invalid permission type: ${permissionType}. Valid types: ${Object.keys(columnMap).join(', ')}`);
  }

  const rolesJson = JSON.stringify(roleIDs ?? []);

  await databaseService.query(
    `
    INSERT INTO guild_settings (guild_id, ${column})
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET ${column} = EXCLUDED.${column}
  `,
    [guildId, rolesJson],
    { rateKey: guildId, context: `setRolePermissions:${permissionType}` }
  );

  databaseService.invalidateGuildSettings(guildId);
}

async function setGuildPlanTier(guildId, planTier) {
  await ensureSchemaReady();

  if (!VALID_PLAN_TIERS.has(planTier)) {
    throw new Error(`Invalid plan tier: ${planTier}. Expected one of ${Array.from(VALID_PLAN_TIERS).join(', ')}`);
  }

  await databaseService.query(
    `
    INSERT INTO guild_settings (guild_id, plan_tier)
    VALUES ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET plan_tier = EXCLUDED.plan_tier
  `,
    [guildId, planTier],
    { rateKey: guildId, context: 'setGuildPlanTier' }
  );

  databaseService.invalidateGuildSettings(guildId);
}

async function getGuildPlanTier(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.plan_tier && VALID_PLAN_TIERS.has(settings.plan_tier)
    ? settings.plan_tier
    : 'non_premium';
}

function getRetentionPolicyForTier(planTier) {
  const tier = VALID_PLAN_TIERS.has(planTier) ? planTier : 'non_premium';
  const seconds = databaseService.getRetentionSecondsForTier(tier);
  return {
    tier,
    seconds,
    intervalLiteral: secondsToIntervalLiteral(seconds),
  };
}

async function getGuildRetentionPolicy(guildId) {
  const tier = await getGuildPlanTier(guildId);
  const { seconds, intervalLiteral } = getRetentionPolicyForTier(tier);
  return { guildId, tier, seconds, intervalLiteral };
}

function normalizeRoleIds(memberRoles) {
  if (memberRoles == null) {
    throw new Error('memberRoles is required for permission checks.');
  }

  if (Array.isArray(memberRoles)) {
    return memberRoles
      .map((role) => (typeof role === 'string' ? role : role?.id))
      .filter(Boolean);
  }

  if (typeof memberRoles.values === 'function') {
    return Array.from(memberRoles.values())
      .map((role) => (typeof role === 'string' ? role : role?.id))
      .filter(Boolean);
  }

  if (typeof memberRoles === 'object' && typeof memberRoles.forEach === 'function') {
    const ids = [];
    memberRoles.forEach((role) => {
      const id = typeof role === 'string' ? role : role?.id;
      if (id) ids.push(id);
    });
    return ids;
  }

  throw new Error(`Unsupported memberRoles type: ${typeof memberRoles}`);
}

async function hasPermissionLevel(guildId, userId, requiredLevel, memberRoles) {
  const settings = await getGuildSettings(guildId);
  if (!settings) return false;

  const roleIds = new Set(normalizeRoleIds(memberRoles));

  const hierarchy = ['helper', 'jr_mod', 'mod', 'admin', 'super_admin'];
  const requiredIndex = hierarchy.indexOf(requiredLevel);

  if (requiredIndex === -1) return false;

  for (let i = requiredIndex; i < hierarchy.length; i++) {
    const level = hierarchy[i];
    const columnName = `roles_${level}`;
    const storedRoles = JSON.parse(settings[columnName] || '[]');

    if (storedRoles.some((roleId) => roleIds.has(roleId))) {
      return true;
    }
  }

  return false;
}

async function getUserPermissionLevel(guildId, userId, memberRoles) {
  const settings = await getGuildSettings(guildId);
  if (!settings) return null;

  const roleIds = new Set(normalizeRoleIds(memberRoles));
  const hierarchy = ['super_admin', 'admin', 'mod', 'jr_mod', 'helper'];

  for (const level of hierarchy) {
    const columnName = `roles_${level}`;
    const storedRoles = JSON.parse(settings[columnName] || '[]');

    if (storedRoles.some((roleId) => roleIds.has(roleId))) {
      return level;
    }
  }

  return null;
}

async function addMutedUser({ guildId, userId, reason, roles, actionedBy, length, expires }) {
  await ensureSchemaReady();

  const timestamp = Date.now().toString();
  const rolesJson = JSON.stringify(roles ?? []);
  const timestampNumber = Number.parseInt(timestamp, 10);
  const recordedAt = Number.isNaN(timestampNumber) ? new Date() : new Date(timestampNumber);
  const expiresMs = typeof expires === 'string' || typeof expires === 'number' ? Number.parseInt(expires, 10) : NaN;
  const expiresAt = Number.isNaN(expiresMs) ? null : new Date(expiresMs);

  await databaseService.query(
    `
    INSERT INTO muted_users (guild_id, user_id, active, reason, roles, actioned_by, length, expires, timestamp, recorded_at, expires_at)
    VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8, $9, $10)
  `,
    [guildId, userId, reason, rolesJson, actionedBy, length, expires, timestamp, recordedAt, expiresAt],
    { rateKey: guildId, context: 'addMutedUser', tokens: 2 }
  );
}

async function getActiveMute(guildId, userId) {
  await ensureSchemaReady();

  const { rows } = await databaseService.query(
    'SELECT * FROM muted_users WHERE guild_id = $1 AND user_id = $2 AND active = TRUE',
    [guildId, userId],
    { rateKey: guildId, context: 'getActiveMute' }
  );

  return rows[0] || null;
}

async function getAllActiveMutes(client) {
  await ensureSchemaReady();

  const guilds = client.guilds.cache.map((g) => g.id);
  if (guilds.length === 0) return [];

  const { rows } = await databaseService.query(
    'SELECT * FROM muted_users WHERE active = TRUE AND guild_id = ANY($1::text[])',
    [guilds],
    { context: 'getAllActiveMutes', tokens: Math.max(1, guilds.length / 5) }
  );

  return rows;
}

async function getExpiredMutes() {
  await ensureSchemaReady();

  const { rows } = await databaseService.query(
    `
    SELECT *
    FROM muted_users
    WHERE active = TRUE
      AND (
        (expires_at IS NOT NULL AND expires_at <= NOW())
        OR (
          expires_at IS NULL
          AND expires IS NOT NULL
          AND expires <> ''
          AND expires ~ '^\\d+$'
          AND CAST(expires AS BIGINT) <= $1
        )
      )
  `,
    [Date.now().toString()],
    { context: 'getExpiredMutes' }
  );

  return rows;
}

async function deactivateMute(muteId) {
  await ensureSchemaReady();

  await databaseService.query(
    'UPDATE muted_users SET active = FALSE WHERE mute_id = $1',
    [muteId],
    { context: 'deactivateMute' }
  );
}

module.exports = {
  pool: databaseService.pool,
  query: (...args) => databaseService.query(...args),

  updateGuildSetting,
  getGuildSettings,
  setRolePermissions,
  setGuildPlanTier,
  getGuildPlanTier,
  getRetentionPolicyForTier,
  getGuildRetentionPolicy,

  getLogChannelId,
  setLogChannelId,
  getVoiceLogChannelId,
  getJoinChannelId,
  getLeaveChannelId,

  getGuildPrefix,
  setGuildPrefix,

  isOpenAIEnabled,

  filteringAI,

  onGuildCreate,
  invalidateGuildSettings: invalidateGuildSettingsCache,
  syncGuildSettings,

  addMutedUser,
  getActiveMute,
  getAllActiveMutes,
  getExpiredMutes,
  deactivateMute,

  hasPermissionLevel,
  getUserPermissionLevel,

  ensureSchemaReady,
  runMigrations: (...args) => databaseService.runMigrations(...args),
  shutdown: () => databaseService.shutdown(),
};
