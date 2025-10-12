// Combined onboarding module: captcha management, selection state, and scheduler
// Previously split across captchaManager.js, onboardingState.js, and onboardingScheduler.js

// --- Captcha/session state ---
const activeCaptchas = new Map();
const userSelections = new Map();

const EXPIRATION_MS = 1 * 60 * 1000; // 1 minute

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    const idx = Math.floor(Math.random() * alphabet.length);
    code += alphabet[idx];
  }
  return code;
}

function getDefaultSelection() {
  return {
    pronoun: null,
    continent: null,
    age: null,
    gaming: null,
  };
}

function getSelections(userId) {
  return userSelections.get(userId) || getDefaultSelection();
}

function setSelection(userId, category, data) {
  const current = getSelections(userId);
  const updated = { ...current, [category]: data };
  userSelections.set(userId, updated);
  return updated;
}

function clearSelections(userId) {
  userSelections.delete(userId);
}

function createSession(userId, meta = null) {
  const code = generateCode();
  const selections = meta ?? getSelections(userId);
  const expiresAt = Date.now() + EXPIRATION_MS;
  activeCaptchas.set(userId, { code, meta: selections, expiresAt });
  return { code, expiresAt, meta: selections };
}

function validateSession(userId, submittedCode) {
  const entry = activeCaptchas.get(userId);

  if (!entry) {
    return { success: false, reason: 'missing' };
  }

  if (Date.now() > entry.expiresAt) {
    activeCaptchas.delete(userId);
    return { success: false, reason: 'expired' };
  }

  const sanitized = submittedCode.trim().toUpperCase();
  if (sanitized !== entry.code.toUpperCase()) {
    return { success: false, reason: 'mismatch' };
  }

  activeCaptchas.delete(userId);
  return { success: true, meta: entry.meta };
}

function clearSession(userId) {
  activeCaptchas.delete(userId);
}

function clearAllState(userId) {
  clearSession(userId);
  clearSelections(userId);
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [userId, entry] of activeCaptchas.entries()) {
    if (entry.expiresAt <= now) {
      activeCaptchas.delete(userId);
    }
  }
}

// --- Simple onboarding selection state (kept for compatibility) ---
// This mirrors the old onboardingState.js; internally we reuse userSelections
function getState(userId) {
  return userSelections.get(userId) || {
    pronoun: null,
    continent: null,
    age: null,
  };
}

function onboardingSetSelection(userId, category, data) {
  // alias that uses same backing map as setSelection
  const current = getState(userId);
  const updated = { ...current, [category]: data };
  userSelections.set(userId, updated);
  return updated;
}

function clearState(userId) {
  userSelections.delete(userId);
}

// --- Onboarding scheduler ---
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

module.exports = {
  // captcha/session API (kept with original names for compatibility)
  createSession,
  validateSession,
  clearSession,
  clearSelections,
  clearAllState,
  setSelection,
  getSelections,
  cleanupExpiredSessions,
  EXPIRATION_MS,

  // onboarding state API (legacy names)
  getState,
  setState: onboardingSetSelection,
  clearState,

  // scheduler API
  schedule,
  cancel,
  has,
};
