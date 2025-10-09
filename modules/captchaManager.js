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

module.exports = {
  createSession,
  validateSession,
  clearSession,
  clearSelections,
  clearAllState,
  setSelection,
  getSelections,
  cleanupExpiredSessions,
  EXPIRATION_MS,
};
