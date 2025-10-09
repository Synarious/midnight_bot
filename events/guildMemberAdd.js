const { Events, EmbedBuilder } = require('discord.js');
const onboardingConfig = require('../data/onboardingConfig.js');
const onboardingScheduler = require('../modules/onboardingScheduler.js');

// Config / constants
const GATE_ROLE_ID = onboardingConfig.GATE_ROLE_ID || '1425702277410455654';
const EXEMPT_ROLE_1 = '1363401486465241149';
const EXEMPT_ROLE_2 = '1346009162823241749';
const LOG_CHANNEL_ID = '1425705491274928138';

// Testing toggles and age window configuration
// Set TESTING = true to use short timers for local testing.
const TESTING = false;

// In testing mode the age window is: more than 30s, up to 60s
const TEST_LOWER_MS = 30 * 1000; 
const TEST_UPPER_MS = 60 * 1000; 

// In production mode these are 10x the testing values
const PROD_LOWER_MS = TEST_LOWER_MS * 5;
const PROD_UPPER_MS = TEST_UPPER_MS * 5; 

// Choose active window based on TESTING flag
const LOWER_AGE_MS = TESTING ? TEST_LOWER_MS : PROD_LOWER_MS;
const UPPER_AGE_MS = TESTING ? TEST_UPPER_MS : PROD_UPPER_MS;

// Schedule the check to run at the lower bound so we verify the user has been a member
// for at least LOWER_AGE_MS and not more than UPPER_AGE_MS
const KICK_DELAY_MS = LOWER_AGE_MS;

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            // Send join embed to log channel
            try {
                const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                if (ch && ch.send) {
                    const embed = new EmbedBuilder()
                        .setTitle('Member Joined')
                        .setColor(0x2ECC71)
                        .setDescription(`${member.user.tag} (${member.id}) joined the server.`)
                        .addFields(
                            { name: 'Joined At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                            { name: 'Account', value: `<@${member.id}>`, inline: true },
                        )
                        .setTimestamp();

                    await ch.send({ embeds: [embed] }).catch(() => null);
                }
            } catch (logErr) {
                console.error('[onboarding] Failed to send join log:', logErr);
            }

            // Schedule a check in 5 minutes to enforce onboarding
            // Send a scheduling debug embed to the log channel so we can trace scheduled tasks
            (async () => {
                try {
                    const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                    if (ch && ch.send) {
                        const accountCreatedTs = member.user.createdTimestamp || Date.now();
                        const accountAgeDays = Math.floor((Date.now() - accountCreatedTs) / (24 * 60 * 60 * 1000));
                        const joinedAtTs = member.joinedTimestamp || Date.now();
                        const roleNames = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).slice(0, 5);

                        const schedEmbed = new EmbedBuilder()
                            .setTitle('Onboarding Check Scheduled')
                            .setColor(0x3498DB)
                            .setDescription(`${member.user.tag} (${member.id}) has an onboarding check scheduled in ${Math.round(KICK_DELAY_MS / 1000)} seconds.`)
                            .addFields(
                                { name: 'Process PID', value: String(process.pid), inline: true },
                                { name: 'Account Created', value: `<t:${Math.floor(accountCreatedTs / 1000)}:R>`, inline: true },
                                { name: 'Account Age', value: `${accountAgeDays} day(s)`, inline: true },
                                { name: 'Joined At', value: `<t:${Math.floor(joinedAtTs / 1000)}:F>`, inline: true },
                                { name: 'Roles (sample)', value: roleNames.length ? roleNames.join(', ') : 'none', inline: false },
                                { name: 'Gate Role', value: `${GATE_ROLE_ID}`, inline: true },
                                { name: 'Exempt Role 1', value: `${EXEMPT_ROLE_1}`, inline: true },
                                { name: 'Exempt Role 2', value: `${EXEMPT_ROLE_2}`, inline: true },
                            )
                            .setTimestamp();

                        await ch.send({ embeds: [schedEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('[onboarding] Failed to send scheduling debug embed:', err);
                }
            })();

            onboardingScheduler.schedule(member.id, async () => {
                // Debug: announce that scheduled check is running
                try {
                    const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                    const now = Date.now();
                    const joinedTs = member.joinedTimestamp || now;
                    const joinedAgoSec = Math.round((now - joinedTs) / 1000);

                    const freshForDebug = await member.guild.members.fetch(member.id).catch(() => null);
                    const hasGate = freshForDebug ? freshForDebug.roles.cache.has(GATE_ROLE_ID) : false;
                    const hasExempt = freshForDebug ? (freshForDebug.roles.cache.has(EXEMPT_ROLE_1) || freshForDebug.roles.cache.has(EXEMPT_ROLE_2)) : false;

                    if (ch && ch.send) {
                        const schedulerHasEntry = require('../modules/onboardingScheduler.js').has(member.id);
                        const accountCreatedTs = freshForDebug?.user?.createdTimestamp || Date.now();
                        const accountAgeDays = Math.floor((Date.now() - accountCreatedTs) / (24 * 60 * 60 * 1000));
                        const joinedAtTs = freshForDebug?.joinedTimestamp || member.joinedTimestamp || Date.now();
                        const roleNames = freshForDebug ? freshForDebug.roles.cache.filter(r => r.id !== freshForDebug.guild.id).map(r => r.name).slice(0, 8) : [];

                        const runEmbed = new EmbedBuilder()
                            .setTitle('Onboarding Check Running')
                            .setColor(0x9B59B6)
                            .setDescription(`${member.user.tag} (${member.id}) scheduled check is now running.`)
                            .addFields(
                                { name: 'Process PID', value: String(process.pid), inline: true },
                                { name: 'Joined (secs ago)', value: `${joinedAgoSec}`, inline: true },
                                { name: 'Account Created', value: `<t:${Math.floor(accountCreatedTs / 1000)}:R>`, inline: true },
                                { name: 'Account Age', value: `${accountAgeDays} day(s)`, inline: true },
                                { name: 'Has Gate Role', value: String(hasGate), inline: true },
                                { name: 'Has Any Exempt Role', value: String(hasExempt), inline: true },
                                { name: 'Scheduler Present', value: String(schedulerHasEntry), inline: true },
                                    { name: 'Kick Attempted', value: 'false', inline: true },
                                { name: 'Roles (sample)', value: roleNames.length ? roleNames.join(', ') : 'none', inline: false }
                            )
                            .setTimestamp();

                        await ch.send({ embeds: [runEmbed] }).catch(() => null);
                    }
                } catch (dbgErr) {
                    console.error('[onboarding] Failed to send scheduled-run debug embed:', dbgErr);
                }

                try {
                    const fresh = await member.guild.members.fetch(member.id).catch(() => null);
                    if (!fresh) return; // user left already

                    const now = Date.now();
                    const joinedAgo = now - (fresh.joinedTimestamp || now);

                    // member age must be at least LOWER_AGE_MS and less-or-equal UPPER_AGE_MS
                    const cond1 = (joinedAgo >= LOWER_AGE_MS) && (joinedAgo <= UPPER_AGE_MS);
                    const cond2 = fresh.roles.cache.has(GATE_ROLE_ID); // still has gate role
                    const cond3 = !(fresh.roles.cache.has(EXEMPT_ROLE_1) || fresh.roles.cache.has(EXEMPT_ROLE_2)); // doesn't have exempt roles

                    // Debug to container logs so we can trace why a kick may not run
                    try {
                        console.debug('[onboarding] scheduled-check', {
                            userId: fresh.id,
                            joinedAgoMs: joinedAgo,
                            lowerMs: LOWER_AGE_MS,
                            upperMs: UPPER_AGE_MS,
                            cond1,
                            cond2,
                            cond3,
                        });
                    } catch (dErr) {
                        // ignore
                    }

                    if (cond1 && cond2 && cond3) {
                        // FINAL SAFETY: verify bot can actually kick and its role is high enough
                        const me = await fresh.guild.members.fetchMe().catch(() => null);
                        const canKick = me && me.permissions.has('KickMembers');

                        // Check role hierarchy: bot's highest role must be above the target's highest role and above the gate role
                        let roleHierarchyOk = false;
                        try {
                            const botHighest = me.roles.highest;
                            const targetHighest = fresh.roles.highest;
                            const gateRole = fresh.guild.roles.cache.get(GATE_ROLE_ID) || await fresh.guild.roles.fetch(GATE_ROLE_ID).catch(() => null);
                            roleHierarchyOk = botHighest.position > targetHighest.position && (!gateRole || botHighest.position > gateRole.position);
                        } catch (hErr) {
                            console.warn('[onboarding] Could not evaluate role hierarchy:', hErr);
                        }

                        if (!canKick || !roleHierarchyOk) {
                            console.warn('[onboarding] Aborting kick due to missing permissions or role hierarchy for', fresh.id);
                            // log the abort
                            try {
                                const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                                if (ch && ch.send) {
                                    const embed = new EmbedBuilder()
                                        .setTitle('Onboarding Kick Aborted')
                                        .setColor(0xE67E22)
                                        .setDescription(`${fresh.user.tag} (${fresh.id}) met criteria but bot lacks permissions or appropriate role position to kick.`)
                                        .addFields(
                                            { name: 'Can Kick', value: String(Boolean(canKick)), inline: true },
                                            { name: 'Role Hierarchy OK', value: String(Boolean(roleHierarchyOk)), inline: true },
                                        )
                                        .setTimestamp();
                                    await ch.send({ embeds: [embed] }).catch(() => null);
                                }
                            } catch (logErr) {
                                console.error('[onboarding] Failed to send abort log:', logErr);
                            }
                            return;
                        }

                        // Post a pending-kick embed to the log channel and wait a short grace period, then re-check before kicking
                        try {
                            const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                            if (ch && ch.send) {
                                const pendingEmbed = new EmbedBuilder()
                                    .setTitle('Onboarding Kick Pending')
                                    .setColor(0xF1C40F)
                                    .setDescription(`${fresh.user.tag} (${fresh.id}) meets the onboarding-failure criteria and will be kicked in 5 seconds unless the situation changes.`)
                                    .addFields(
                            { name: 'Had Gate Role', value: String(cond2), inline: true },
                            { name: 'Exempt Roles Present', value: String(!cond3), inline: true },
                                        { name: `Joined in window (>= ${Math.round(LOWER_AGE_MS/1000)}s and <= ${Math.round(UPPER_AGE_MS/1000)}s)`, value: String(cond1), inline: true },
                                            { name: 'Kick Attempted', value: 'false', inline: true },
                                    )
                                    .setTimestamp();

                                await ch.send({ embeds: [pendingEmbed] }).catch(() => null);
                            }
                        } catch (logErr) {
                            console.error('[onboarding] Failed to send pending kick log:', logErr);
                        }

                        // Wait a short grace period to avoid races
                        await new Promise(res => setTimeout(res, 5000));

                        // Re-fetch and re-evaluate conditions
                        const fresh2 = await member.guild.members.fetch(member.id).catch(() => null);
                        if (!fresh2) return; // already left

                        const now2 = Date.now();
                        const joinedAgo2 = now2 - (fresh2.joinedTimestamp || now2);
                        const cond1b = (joinedAgo2 >= LOWER_AGE_MS) && (joinedAgo2 <= UPPER_AGE_MS);
                        const cond2b = fresh2.roles.cache.has(GATE_ROLE_ID);
                        const cond3b = !(fresh2.roles.cache.has(EXEMPT_ROLE_1) || fresh2.roles.cache.has(EXEMPT_ROLE_2));

                        if (!(cond1b && cond2b && cond3b)) {
                            // situation changed; abort
                            try {
                                const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                                if (ch && ch.send) {
                                    const embed = new EmbedBuilder()
                                        .setTitle('Onboarding Kick Aborted')
                                        .setColor(0x95A5A6)
                                        .setDescription(`${fresh2.user.tag} (${fresh2.id}) no longer meets the kick criteria after final check.`)
                                        .addFields(
                                            { name: 'Had Gate Role (now)', value: String(cond2b), inline: true },
                                            { name: 'Exempt Roles Present (now)', value: String(!cond3b), inline: true },
                                            { name: `Joined in window (>= ${Math.round(LOWER_AGE_MS/1000)}s and <= ${Math.round(UPPER_AGE_MS/1000)}s)`, value: String(cond1b), inline: true },
                                                { name: 'Kick Attempted', value: 'false', inline: true },
                                        )
                                        .setTimestamp();

                                    await ch.send({ embeds: [embed] }).catch(() => null);
                                }
                            } catch (logErr) {
                                console.error('[onboarding] Failed to send abort-after-final-check log:', logErr);
                            }
                            return;
                        }

                        // Attempt to kick now
                        let kicked = false;
                        try {
                            await fresh2.kick('Failed to complete onboarding (captcha) within 5 minutes');
                            kicked = true;
                        } catch (kickErr) {
                            console.error('[onboarding] Failed to kick member after final check:', fresh2.id, kickErr);
                        }

                        // send failure embed to log channel
                        try {
                            const ch = member.guild.channels.cache.get(LOG_CHANNEL_ID) || await member.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                            if (ch && ch.send) {
                                const embed = new EmbedBuilder()
                                    .setTitle('Failed to Complete Onboarding')
                                    .setColor(0xE74C3C)
                                    .setDescription(`${fresh2.user.tag} (${fresh2.id}) ${kicked ? 'was kicked' : 'met criteria but kick failed' } for not completing onboarding.`)
                                    .addFields(
                                        { name: 'Had Gate Role', value: String(cond2b), inline: true },
                                        { name: 'Exempt Roles Present', value: String(!cond3b), inline: true },
                                        { name: 'Joined Recent (30m)', value: String(cond1b), inline: true },
                                            { name: 'Kick Attempted', value: String(kicked), inline: true },
                                    )
                                    .setTimestamp();

                                await ch.send({ embeds: [embed] }).catch(() => null);
                            }
                        } catch (logErr) {
                            console.error('[onboarding] Failed to send onboarding-kick embed:', logErr);
                        }
                    }
                } catch (err) {
                    console.error('[onboarding] Error during scheduled onboarding check:', err);
                }
            }, KICK_DELAY_MS);
        } catch (error) {
            console.error('[onboarding] Error in GuildMemberAdd handler:', error);
        }
    },
};
