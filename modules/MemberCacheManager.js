const { Collection } = require('discord.js');
const Fuse = require('fuse.js');

const MIN_REFRESH_MS = 60 * 1000;
const MAX_REFRESH_MS = 300 * 1000;
const FUSE_THRESHOLD = 0.3;

function getMemberNames(member) {
    const names = [member.user.username, member.user.globalName];
    if (member.nickname) names.push(member.nickname);
    return [...new Set(names.filter(Boolean))];
}

class MemberCacheManager {
    constructor() {
        this.cache = new Collection();
    }

    async buildCacheForGuild(guild) {
        // console.log(`[Cache] Refreshing member list for: ${guild.name}`);
        try {
            const members = await guild.members.fetch();
            const data = members.map(member => ({
                id: member.id,
                names: getMemberNames(member),
            }));

            const fuseOptions = {
                keys: ['names'],
                includeScore: true,
                threshold: FUSE_THRESHOLD,
                ignoreLocation: true,
            };

            const fuseIndex = Fuse.createIndex(fuseOptions.keys, data);
            const fuse = new Fuse(data, fuseOptions, fuseIndex);

            this.cache.set(guild.id, {
                fuse,
                lastUpdated: Date.now(),
            });

            const refreshIn = MIN_REFRESH_MS + Math.random() * (MAX_REFRESH_MS - MIN_REFRESH_MS);
            setTimeout(() => this.buildCacheForGuild(guild), refreshIn);

        } catch (err) {
            console.error(`[Cache] Failed to refresh ${guild.name}:`, err);
        }
    }

    async getFuseForGuild(guild) {
        const cached = this.cache.get(guild.id);
        const now = Date.now();

        if (!cached || (now - cached.lastUpdated > MAX_REFRESH_MS)) {
            await this.buildCacheForGuild(guild);
            return cached?.fuse ?? null;
        }

        return cached.fuse;
    }

    async initialize(client) {
        for (const guild of client.guilds.cache.values()) {
            await this.buildCacheForGuild(guild);
        }
    }

    addMember(member) {
        const cache = this.cache.get(member.guild.id);
        if (cache) {
            cache.fuse.add({ id: member.id, names: getMemberNames(member) });
        }
    }

    removeMember(member) {
        const cache = this.cache.get(member.guild.id);
        if (cache) {
            cache.fuse.remove(doc => doc.id === member.id);
        }
    }

    updateMember(member) {
        const cache = this.cache.get(member.guild.id);
        if (cache) {
            cache.fuse.remove(doc => doc.id === member.id);
            cache.fuse.add({ id: member.id, names: getMemberNames(member) });
        }
    }
}

module.exports = new MemberCacheManager();
