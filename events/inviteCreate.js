const { Events } = require('discord.js');
const inviteTracker = require('../modules/inviteTracker.js');

module.exports = {
    name: Events.InviteCreate,
    async execute(invite) {
        await inviteTracker.handleInviteCreate(invite);
    }
};