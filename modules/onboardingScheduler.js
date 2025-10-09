// Simple in-memory scheduler for onboarding kick timeouts.
// Stores timeouts keyed by user ID so they can be cancelled when onboarding completes.

const timeouts = new Map();

function schedule(userId, fn, delay) {
  // If a timeout already exists, clear it first
  if (timeouts.has(userId)) {
    clearTimeout(timeouts.get(userId));
  }

  const t = setTimeout(async () => {
    try {
      await fn(); // await the callback if it's async
    } catch (err) {
      console.error(`[onboardingScheduler] error in scheduled callback for ${userId}:`, err);
    } finally {
      timeouts.delete(userId); // delete only after callback fully completes
    }
  }, delay);

  timeouts.set(userId, t);
  console.debug(`[onboardingScheduler] scheduled timeout for ${userId} in ${delay}ms`);
  return t;
}

function cancel(userId) {
  const t = timeouts.get(userId);
  if (t) {
    clearTimeout(t);
    timeouts.delete(userId);
    console.debug(`[onboardingScheduler] cancelled timeout for ${userId}`);
    return true;
  }
  return false;
}

function has(userId) {
  return timeouts.has(userId);
}

module.exports = { schedule, cancel, has };
