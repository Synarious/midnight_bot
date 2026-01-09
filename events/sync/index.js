const { Events } = require('discord.js');
const database = require('../../data/database.js');

// Centralized sync handlers for channels and roles.
// This module attaches listeners on ClientReady so it can access `client` directly
// and perform the initial full-guild sync before attaching incremental handlers.

async function upsertChannel(channel, guildId) {
    try {
        await database.pool.query(
            `INSERT INTO discord_channels (channel_id, guild_id, name, type, position, parent_id, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (channel_id) DO UPDATE SET
             name = EXCLUDED.name, type = EXCLUDED.type, position = EXCLUDED.position,
             parent_id = EXCLUDED.parent_id, updated_at = NOW()`,
            [channel.id, guildId || (channel.guild && channel.guild.id), channel.name, channel.type, channel.position, channel.parentId]
        );
    } catch (error) {
        console.error(`[Sync] Failed to upsert channel ${channel.id}:`, error);
    }
}

async function deleteChannel(channel) {
    try {
        await database.pool.query('DELETE FROM discord_channels WHERE channel_id = $1', [channel.id]);
    } catch (error) {
        console.error(`[Sync] Failed to delete channel ${channel.id}:`, error);
    }
}

async function upsertRole(role) {
    try {
        await database.pool.query(
            `INSERT INTO discord_roles (role_id, guild_id, name, color, position, permissions, managed, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (role_id) DO UPDATE SET
             name = EXCLUDED.name, color = EXCLUDED.color, position = EXCLUDED.position,
             permissions = EXCLUDED.permissions, managed = EXCLUDED.managed, updated_at = NOW()`,
            [role.id, role.guild.id, role.name, role.color, role.position, role.permissions.bitfield.toString(), role.managed]
        );
    } catch (error) {
        console.error(`[Sync] Failed to upsert role ${role.id}:`, error);
    }
}

async function deleteRole(role) {
    try {
        await database.pool.query('DELETE FROM discord_roles WHERE role_id = $1', [role.id]);
    } catch (error) {
        console.error(`[Sync] Failed to delete role ${role.id}:`, error);
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log('[Sync] Starting consolidated sync module...');

        // Attach incremental handlers first so they catch changes during the initial sync
        client.on(Events.ChannelCreate, async (channel) => {
            if (!channel.guild) return;
            await upsertChannel(channel);
        });

        client.on(Events.ChannelDelete, async (channel) => {
            if (!channel.guild) return;
            await deleteChannel(channel);
        });

        client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
            if (!newChannel.guild) return;
            await upsertChannel(newChannel);
        });

        client.on(Events.GuildRoleCreate, async (role) => {
            await upsertRole(role);
        });

        client.on(Events.GuildRoleDelete, async (role) => {
            await deleteRole(role);
        });

        client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
            await upsertRole(newRole);
        });

        // Perform initial full sync of channels and roles for all cached guilds
        try {
            console.log('[Sync] Performing initial guild sync...');
            for (const guild of client.guilds.cache.values()) {
                try {
                    // Channels
                    const channels = await guild.channels.fetch();
                    for (const channel of channels.values()) {
                        await upsertChannel(channel, guild.id);
                    }

                    // Roles
                    const roles = await guild.roles.fetch();
                    for (const role of roles.values()) {
                        await upsertRole(role);
                    }

                    console.log(`[Sync] Synced guild: ${guild.name}`);
                } catch (err) {
                    console.error(`[Sync] Failed to sync guild ${guild.id}:`, err);
                }
            }
            console.log('[Sync] Initial sync complete. Incremental listeners attached.');
        } catch (err) {
            console.error('[Sync] Initial sync failed:', err);
        }
    }
};
