// Minimal voice activity tracker implementation.
// The bot references this module from index.js. In some deployments this file was missing,
// which prevents the bot from starting and breaks dashboard features that depend on the bot.

function startWorkers() {
  // Placeholder: voice activity tracking is optional.
  console.log('[VoiceActivityTracker] startWorkers() - no-op');
}

function handleVoiceStateUpdate(_oldState, _newState) {
  // Placeholder: no-op.
}

function stopWorkers() {
  // Placeholder: no-op.
}

module.exports = {
  startWorkers,
  stopWorkers,
  handleVoiceStateUpdate,
};
