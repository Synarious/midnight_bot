const rateLimiter = require('../utils/rateLimiter');


function format(ms) {
  const date = new Date(Date.now() - ms);
  return `${ms}ms (${Math.ceil(ms/1000)}s) ago, UTC: ${date.toISOString()}`;
}

async function run() {
  const user = 'test-user-1';
  const id = 'cmd:test';

  // Clear any existing
  rateLimiter.clearUserRateLimits(user);

  console.log('Touching rate limit (normal)');
  rateLimiter.touchRateLimit(user, id);
  let res = rateLimiter.checkRateLimit(user, id, 5000);
  console.log('Immediately after touch, limited?', res.limited, 'remaining:', format(res.remainingMs), 'now UTC:', new Date().toISOString());

  // Simulate seconds-based stored timestamp (older)
  const nowSec = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
  // Directly poking internal map for simulation (not ideal but useful for test)
  const rlMap = require('../utils/rateLimiter').__test_get_map?.() || null;
  if (rlMap && rlMap.set) {
  console.log('Found test helper map, setting seconds-based timestamp (UTC):', new Date(nowSec * 1000).toISOString());
  rlMap.set(user, new Map([[id, nowSec]]));
  res = rateLimiter.checkRateLimit(user, id, 15000);
  console.log('After seconds-based timestamp (should not be treated as future): limited?', res.limited, 'remaining:', format(res.remainingMs), 'now UTC:', new Date().toISOString());
  } else {
    console.log('No internal test accessor available; skipping seconds-based direct set test.');
  }

  // Simulate future timestamp (in seconds) to ensure clamping
  rateLimiter.clearUserRateLimits(user);
  const futureSec = Math.floor(Date.now() / 1000) + 7200; // 2 hours in future
  if (rlMap && rlMap.set) {
    console.log('Setting future timestamp (UTC):', new Date(futureSec * 1000).toISOString());
    rlMap.set(user, new Map([[id, futureSec]]));
    res = rateLimiter.checkRateLimit(user, id, 5000);
    console.log('After future seconds timestamp, limited?', res.limited, 'remaining:', format(res.remainingMs), 'now UTC:', new Date().toISOString());
  }

  console.log('Done');
}

run().catch(e => { console.error('Test error', e); process.exit(1); });
