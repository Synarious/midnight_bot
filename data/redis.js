const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  retryStrategy: (times) => {
    // Retry connection up to 10 times, with exponential backoff
    if (times > 10) {
      return null; // Stop retrying
    }
    return Math.min(times * 50, 2000);
  },
});

redis.on('error', (err) => {
  console.error('[Redis] Connection Error:', err);
});

redis.on('connect', () => {
  console.log('[Redis] Connected to Redis');
});

module.exports = redis;
