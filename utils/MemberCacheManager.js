// Lightweight Map-based TTL cache (no external dependency) exported as singleton
function createMemberCache(options = {}) {
  const maxEntries = options.max || 10000;
  const ttl = options.ttl || 1000 * 60 * 60; // default 1 hour
  const store = new Map(); // key -> { value, expiresAt }
  let clientRef = null;

  function makeKey(guildId, memberId) {
    return `${guildId}:${memberId}`;
  }

  function pruneExpired() {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
    // If store size too large, remove oldest entries
    if (store.size > maxEntries) {
      const toRemove = store.size - maxEntries;
      const iter = store.keys();
      for (let i = 0; i < toRemove; i++) {
        const k = iter.next().value;
        if (k) store.delete(k);
      }
    }
  }

  function setEntry(key, value) {
    pruneExpired();
    store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  function getEntry(key) {
    const e = store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return e.value;
  }

  return {
    async initialize(client) {
      clientRef = client;
      return true;
    },

    addMember(member) {
      try {
        const guildId = member.guild?.id || member.guildId;
        if (!guildId) return;
        const key = makeKey(guildId, member.id);
        setEntry(key, member);
      } catch (e) {}
    },

    removeMember(member) {
      try {
        const guildId = member.guild?.id || member.guildId;
        if (!guildId) return;
        const key = makeKey(guildId, member.id);
        store.delete(key);
      } catch (e) {}
    },

    updateMember(member) {
      try {
        const guildId = member.guild?.id || member.guildId;
        if (!guildId) return;
        const key = makeKey(guildId, member.id);
        setEntry(key, member);
      } catch (e) {}
    },

    async buildCacheForGuild(guild) {
      try {
        if (!guild || typeof guild.members?.fetch !== 'function') return;
        const members = await guild.members.fetch({ force: false }).catch(() => null);
        if (!members) return;
        for (const m of members.values()) {
          const key = makeKey(guild.id, m.id);
          setEntry(key, m);
        }
      } catch (e) {}
    },

    cleanupGuild(guildId) {
      try {
        const prefix = `${guildId}:`;
        for (const key of Array.from(store.keys())) {
          if (key.startsWith(prefix)) store.delete(key);
        }
      } catch (e) {}
    },

    get(guildId, memberId) {
      return getEntry(makeKey(guildId, memberId));
    },

    clear() {
      store.clear();
    },
  };
}

module.exports = createMemberCache();
