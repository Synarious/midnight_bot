const {
    Events,
    MessageFlags,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require('discord.js');
const captchaManager = require('../modules/captchaManager.js');
const onboardingConfig = require('../data/onboardingConfig.js');
const db = require('../data/database.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        try {
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.slashCommands.get(interaction.commandName);

                if (!command) {
                    console.error(`No slash command matching ${interaction.commandName} was found.`);
                    return;
                }

                // Attach DB to interaction
                interaction.client.botStorage = require('../data/database.js'); // Ensure correct path
                await command.execute(interaction);

            } else if (interaction.isButton()) {
                const customId = interaction.customId;

                // Handle role menu refresh button
                if (customId === 'role_menu_refresh') {
                    const roleMenuCommand = interaction.client.slashCommands.get('role-menu');
                    if (roleMenuCommand && roleMenuCommand.handleRefreshButton) {
                        await roleMenuCommand.handleRefreshButton(interaction);
                        return;
                    }
                }

                if (customId.startsWith('showFlaggedMessages_')) {
                    const userId = customId.split('_')[1];
                    const dbModule = require('../data/database.js');

                    // Fetch last 5 filtered messages
                    const result = await dbModule.pool.query(`
                        SELECT timestamp, channel_id 
                        FROM user_modlog
                        WHERE guild_id = $1 AND user_id = $2
                        ORDER BY timestamp DESC
                        LIMIT 5
                    `, [interaction.guild.id, userId]);
                    
                    if (!result.rows.length) {
                        return interaction.reply({ content: 'No flagged messages found for that user.', ephemeral: true });
                    }
                    
                    const flaggedMessages = result.rows;

                    if (!flaggedMessages || flaggedMessages.length === 0) {
                        return interaction.reply({ content: 'No flagged messages found for that user.', ephemeral: true });
                    }

                    const fields = result.rows.map((msg, i) => {
                        const timeString = new Date(msg.timestamp).toLocaleString();
                        const channelMention = `<#${msg.channel_id}>`;
                        return {
                            name: `Message ${i + 1} (${timeString})`,
                            value: `Channel: ${channelMention}\nMessage was flagged.`,
                        };
                    });

                    const embed = new EmbedBuilder()
                        .setTitle(`Last 5 Flagged Messages for <@${userId}>`)
                        .setColor(0xFFA500)
                        .addFields(fields)
                        .setTimestamp();

                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                if (customId === 'onboarding_finish') {
                    let state = captchaManager.getSelections(interaction.user.id);

                    // If selections are missing (e.g., due to race or storage issue), fall back to checking member roles directly
                    const memberForCheck = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
                    const ensureSelectionFromRoles = (categoryName, storageKey) => {
                        if (state[storageKey]) return;
                        const cat = onboardingConfig.getCategoryByName(categoryName);
                        if (!cat || !Array.isArray(cat.roles)) return;
                        for (const r of cat.roles) {
                            if (memberForCheck.roles.cache.has(r.id)) {
                                state = { ...state, [storageKey]: { key: r.key, label: r.name, roleId: r.id } };
                                break;
                            }
                        }
                    };

                    ensureSelectionFromRoles('Pronouns', 'pronoun');
                    ensureSelectionFromRoles('Region', 'continent');
                    ensureSelectionFromRoles('Age', 'age');
                    ensureSelectionFromRoles('Gaming', 'gaming');

                    if (!state.pronoun) {
                        return interaction.reply({ content: '⚠️ Please select your pronouns before finishing.', ephemeral: true });
                    }

                    if (!state.continent) {
                        return interaction.reply({ content: '⚠️ Please select your region before finishing.', ephemeral: true });
                    }

                    if (!state.age) {
                        return interaction.reply({ content: '⚠️ Please select your age group before finishing.', ephemeral: true });
                    }

                    if (!state.gaming) {
                        return interaction.reply({ content: '⚠️ Please select your gaming preference before finishing.', ephemeral: true });
                    }

                    captchaManager.cleanupExpiredSessions();
                    const { code } = captchaManager.createSession(interaction.user.id, state);

                    const modal = new ModalBuilder()
                        .setCustomId('captcha_modal')
                        .setTitle('Captcha Verification');

                    const captchaInput = new TextInputBuilder()
                        .setCustomId('captchaInput')
                        .setLabel(`Enter captcha: ${code}`)
                        .setPlaceholder('Type the code exactly as shown above.')
                        .setMinLength(code.length)
                        .setMaxLength(code.length)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const row = new ActionRowBuilder().addComponents(captchaInput);
                    modal.addComponents(row);

                    await interaction.showModal(modal);
                    return;
                }
            }

            if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;

                // Handle role menu selections
                if (customId.startsWith('role_menu_')) {
                    const roleMenuCommand = interaction.client.slashCommands.get('role-menu');
                    if (roleMenuCommand && roleMenuCommand.handleRoleSelection) {
                        await roleMenuCommand.handleRoleSelection(interaction);
                        return;
                    }
                }

                if (customId.startsWith('onboarding_select:')) {
                    const categoryKey = customId.split(':')[1];
                    
                    // Map category keys to category names
                    const categoryNameMap = {
                        'pronoun': 'Pronouns',
                        'pronouns': 'Pronouns',
                        'continent': 'Region',
                        'region': 'Region',
                        'age': 'Age',
                        'gaming': 'Gaming'
                    };
                    
                    const categoryName = categoryNameMap[categoryKey.toLowerCase()];
                    const categoryConfig = onboardingConfig.getCategoryByName(categoryName);

                    if (!categoryConfig) {
                        return interaction.reply({ content: '⚠️ This selection is not configured yet. Please notify an administrator.', ephemeral: true });
                    }

                    const choices = categoryConfig.roles;
                    
                    if (!choices || !Array.isArray(choices)) {
                        return interaction.reply({ content: '⚠️ This selection is not configured yet. Please notify an administrator.', ephemeral: true });
                    }

                    const selectedKey = interaction.values?.[0];
                    const choice = choices.find(option => option.key === selectedKey);

                    if (!choice) {
                        return interaction.reply({ content: '⚠️ Unknown selection. Please try again.', ephemeral: true });
                    }

                    const roleId = choice.id; // Changed from choice.roleId to choice.id
                    const roleIdIsValid = typeof roleId === 'string' && /^\d{17,20}$/.test(roleId);

                    if (!roleIdIsValid) {
                        return interaction.reply({ content: '⚠️ Role ID for this option is not configured. Please notify an administrator.', ephemeral: true });
                    }

                    const guildRole = interaction.guild.roles.cache.get(roleId);

                    if (!guildRole) {
                        return interaction.reply({ content: '⚠️ The configured role could not be found in this server. Please notify an administrator.', ephemeral: true });
                    }

                    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);

                    // Get all other role IDs in this category to remove them
                    const siblingRoleIds = choices
                        .filter(opt => opt.id !== roleId)
                        .map(opt => opt.id)
                        .filter(id => /^\d{17,20}$/.test(id));

                    const rolesToRemove = member.roles.cache.filter(role => siblingRoleIds.includes(role.id));

                    try {
                        if (rolesToRemove.size) {
                            await member.roles.remove([...rolesToRemove.keys()]);
                        }

                        if (!member.roles.cache.has(roleId)) {
                            await member.roles.add(roleId);
                        }
                    } catch (roleError) {
                        console.error('[onboarding] Failed to update roles for selection:', roleError);
                        return interaction.reply({ content: '⚠️ I could not update your roles. Please contact a moderator.', ephemeral: true });
                    }

                    // Normalize storage key to the singular keys used by captchaManager
                    let storageKey;
                    switch (categoryKey.toLowerCase()) {
                        case 'pronouns':
                        case 'pronoun':
                            storageKey = 'pronoun';
                            break;
                        case 'region':
                        case 'continent':
                            storageKey = 'continent';
                            break;
                        case 'age':
                            storageKey = 'age';
                            break;
                        case 'gaming':
                            storageKey = 'gaming';
                            break;
                        default:
                            storageKey = categoryKey;
                    }

                    captchaManager.setSelection(interaction.user.id, storageKey, {
                        key: choice.key,
                        label: choice.name,
                        roleId,
                    });

                    // Debug: log stored selections for troubleshooting
                    try {
                        const debugSelections = captchaManager.getSelections(interaction.user.id);
                        console.debug('[onboarding-debug] stored selections for', interaction.user.id, debugSelections);
                    } catch (dbgErr) {
                        console.error('[onboarding-debug] failed to read stored selections:', dbgErr);
                    }

                    // Acknowledge the select interaction silently (no visible reply)
                    try {
                        await interaction.deferUpdate();
                    } catch (ackErr) {
                        // Unable to defer update; intentionally do not reply to keep channel clean
                        console.warn('[onboarding] Could not deferUpdate interaction; no reply will be sent.');
                    }
                    return;
                }
            }

            if (interaction.isModalSubmit()) {
                const { customId } = interaction;

                if (customId === 'captcha_modal') {
                    const submittedCode = interaction.fields.getTextInputValue('captchaInput');
                    const validation = captchaManager.validateSession(interaction.user.id, submittedCode);

                    if (!validation.success) {
                        let reasonMessage = 'The code you entered was incorrect or expired. Please try again.';
                        if (validation.reason === 'expired') {
                            reasonMessage = 'The captcha has expired. Click the finish button again to receive a new code.';
                        } else if (validation.reason === 'missing') {
                            reasonMessage = 'No active captcha found. Click the finish button to receive a fresh code.';
                        }

                        // Log failed attempt to the moderation/log channel
                        try {
                            const logChannelId = '1425705491274928138';
                            const logChannel = interaction.guild.channels.cache.get(logChannelId) || await interaction.guild.channels.fetch(logChannelId).catch(() => null);
                            if (logChannel && logChannel.send) {
                                const currentSelections = captchaManager.getSelections(interaction.user.id) || {};
                                const selectionsText = Object.entries(currentSelections).map(([k, v]) => `${k}: ${v?.label || v?.name || v?.key || v}`).join('\n') || 'No selections';

                                // Include what the user submitted when applicable
                                let providedText = '';
                                if (validation.reason === 'mismatch') {
                                    const provided = submittedCode ?? '(no input)';
                                    providedText = `\nProvided value: ${provided}`;
                                }

                                // Different message for missing vs other failures
                                if (validation.reason === 'missing') {
                                    await logChannel.send(`⚠️ Missing captcha session when user attempted verification\nUser: ${interaction.user.tag} (${interaction.user.id})\nSelections:\n${selectionsText}`);
                                } else {
                                    await logChannel.send(`⚠️ Failed captcha attempt\nUser: ${interaction.user.tag} (${interaction.user.id})\nReason: ${validation.reason || 'unknown'}${providedText}\nSelections:\n${selectionsText}`);
                                }
                            }
                        } catch (logError) {
                            console.error('[onboarding] Failed to log failed captcha attempt:', logError);
                        }

                        await interaction.reply({ content: `❌ ${reasonMessage}`, ephemeral: true });
                        return;
                    }

                    const meta = validation.meta || {};
                                        captchaManager.clearSelections(interaction.user.id);
                                        // Cancel any scheduled onboarding kick for this user
                                        try {
                                            const onboardingScheduler = require('../modules/onboardingScheduler.js');
                                            const cancelled = onboardingScheduler.cancel(interaction.user.id);
                                            console.debug('[onboarding] scheduled kick cancel result for', interaction.user.id, cancelled);

                                            // Send a cancellation log to the moderation/log channel so we can trace it
                                            try {
                                                const LOG_CHANNEL_ID = '1425705491274928138';
                                                const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID) || await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                                                if (logChannel && logChannel.send) {
                                                    const cancelEmbed = new EmbedBuilder()
                                                        .setTitle('Onboarding Kick Cancelled')
                                                        .setColor(0x2ECC71)
                                                        .setDescription(`${interaction.user.tag} (${interaction.user.id}) completed onboarding — scheduled kick ${cancelled ? 'was cancelled' : 'had no scheduled entry (already cleared)'}.`)
                                                        .addFields(
                                                            { name: 'Cancelled', value: String(cancelled), inline: true },
                                                            { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                                                        )
                                                        .setTimestamp();

                                                    await logChannel.send({ embeds: [cancelEmbed] }).catch(() => null);
                                                }
                                            } catch (logErr) {
                                                console.error('[onboarding] Failed to send scheduled-cancel log:', logErr);
                                            }
                                        } catch (schErr) {
                                            console.warn('[onboarding] Could not cancel scheduled kick (scheduler missing?):', schErr);
                                        }

                    // Remove gate role if present
                    const GATE_ROLE_ID = onboardingConfig.GATE_ROLE_ID || '1425702277410455654';
                    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
                    
                    if (member.roles.cache.has(GATE_ROLE_ID)) {
                        try {
                            await member.roles.remove(GATE_ROLE_ID);
                            console.log(`[onboarding] Removed gate role from user ${interaction.user.id}`);
                        } catch (error) {
                            console.error(`[onboarding] Failed to remove gate role from user ${interaction.user.id}:`, error);
                        }
                    }

                    const pronounLabel = meta.pronoun?.label || meta.pronoun?.name || 'your pronouns';
                    const regionLabel = meta.continent?.label || meta.continent?.name;
                    const ageLabel = meta.age?.label || meta.age?.name;
                    const gamingLabel = meta.gaming?.label || meta.gaming?.name;

                    const summaryParts = [`Preferred pronouns: **${pronounLabel}**`];
                    if (regionLabel) {
                        summaryParts.push(`Region: **${regionLabel}**`);
                    }
                    if (ageLabel) {
                        summaryParts.push(`Age group: **${ageLabel}**`);
                    }
                    if (gamingLabel) {
                        summaryParts.push(`Gaming: **${gamingLabel}**`);
                    }

                    const summary = summaryParts.join('\n');

                    // Send welcome messages to a dedicated welcome channel and an embed to the welcome-crew channel
                    (async () => {
                        try {
                            const welcomeChannelId = '1346007514193330178'; // welcome-channel
                            const crewChannelId = '1372108730786910258'; // welcome-crew embed channel

                            const welcomeChannel = interaction.guild.channels.cache.get(welcomeChannelId) || await interaction.guild.channels.fetch(welcomeChannelId).catch(() => null);
                            const crewChannel = interaction.guild.channels.cache.get(crewChannelId) || await interaction.guild.channels.fetch(crewChannelId).catch(() => null);

                            const userMention = `<@${interaction.user.id}>`;
                            const userName = interaction.user.username || interaction.user.tag || interaction.user.id;

                            const templates = [
                                `Welcome ${userMention}! Love the name — it’s got character. Glad you made it.`,
                                `Hey ${userMention}, nice avatar! We're happy you joined — no pressure to reply, just say hi when you feel like it.`,
                                `${userMention} has arrived — stylish name. Hope you like it here.`,
                                `Nice to see you ${userMention}! Your profile looks cool — enjoy your stay.`,
                                `Welcome ${userMention}! We already think your username is awesome. Make yourself at home.`,
                                `Hey ${userMention}, welcome aboard — that name is unforgettable in the best way.`,
                                `Yo ${userMention}! Your profile pic slaps. Stick around and say hello whenever.`,
                                `${userMention} — welcome! No need to reply, but if you want, tell us your favourite hobby.`,
                                `Hi ${userMention}! That display name is neat. Hope you find some fun here.`,
                                `Welcome ${userMention}! Quiet arrival? That’s cool — lurkers welcome too.`,
                                `Hey ${userMention}, glad you joined — your username gives off good vibes.`,
                                `Welcome ${userMention}! If your name had a theme song, we’d be playing it.`,
                                `Hi ${userMention}! Love the handle — hope the server feels like a good fit.`,
                                `Welcome ${userMention}! Your profile caught our eye — feel free to poke around.`,
                                `${userMention}, welcome! If you’re into games/music/art, you’ll find people here.`,
                                `Hey ${userMention}, that avatar is cool — nice to have you here.`,
                                `Welcome ${userMention}! No intro required, but we’d love to hear what you’re into when you’re ready.`,
                                `Nice to meet you ${userMention}! You picked a solid username — enjoy the server.`,
                                `Welcome ${userMention}! If you want recs, ask later — for now, enjoy the vibes.`,
                                `Hey ${userMention}, subtle flex: great username. Welcome aboard.`,
                                `Welcome ${userMention}! Your name says "I belong here" — and you do.`,
                                `Hi ${userMention}! We appreciate a tasteful profile pic — welcome.`,
                                `Welcome ${userMention}! Pop in when you feel like it — we’re chill.`,
                                `Hey ${userMention}, love the energy your name gives — glad you joined.`,
                                `Welcome ${userMention}! Your join made the server a little cooler already.`
                            ];

                            const pick = templates[Math.floor(Math.random() * templates.length)];

                            if (welcomeChannel && welcomeChannel.send) {
                                await welcomeChannel.send({ content: pick }).catch(() => null);
                            }

                            if (crewChannel && crewChannel.send) {
                                const avatarUrl = member.user.displayAvatarURL({ size: 1024, extension: 'png' });
                                const embed = new EmbedBuilder()
                                    .setColor(0xFFFFFF)
                                    .setThumbnail(avatarUrl)
                                    .addFields(
                                        { name: 'Names:', value: `${member.toString()}  | \`${userName}\` | \`${member.user.globalName || ''}\``, inline: false },
                                        { name: 'Go To Location:', value: `https://discordapp.com/channels/${member.guild.id}/${welcomeChannelId}`, inline: false },
                                        { name: 'Want To Disable Notifications?:', value: 'Go Here: <id:customize>', inline: false },
                                    );

                                await crewChannel.send({ embeds: [embed] }).catch(() => null);
                            }
                        } catch (sendError) {
                            console.error('[onboarding] Failed to send welcome messages:', sendError);
                        }
                    })();

                    // Log successful onboarding to moderation/log channel
                    try {
                        const LOG_CHANNEL_ID = '1425705491274928138';
                        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID) || await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                        if (logChannel && logChannel.send) {
                            const state = meta || {};
                            const getLabel = (v) => (v && (v.label || v.name || v.key)) || '—';

                            const successEmbed = new EmbedBuilder()
                                .setTitle('Onboarding Completed')
                                .setColor(0x57F287)
                                .setDescription(`${member ? `<@${interaction.user.id}>` : interaction.user.tag} (${interaction.user.id}) completed onboarding and passed captcha.`)
                                .addFields(
                                    { name: 'Pronoun', value: getLabel(state.pronoun), inline: true },
                                    { name: 'Region', value: getLabel(state.continent), inline: true },
                                    { name: 'Age', value: getLabel(state.age), inline: true },
                                    { name: 'Gaming', value: getLabel(state.gaming), inline: true },
                                    { name: 'Gate Role Removed', value: member ? (member.roles.cache.has(onboardingConfig.GATE_ROLE_ID) ? 'No' : 'Yes') : 'Unknown', inline: true },
                                )
                                .setTimestamp();

                            await logChannel.send({ embeds: [successEmbed] }).catch(() => null);
                        }
                    } catch (logErr) {
                        console.error('[onboarding] Failed to send onboarding success log:', logErr);
                    }

                    await interaction.reply({
                        content: `✅ Captcha complete! Welcome aboard!\n${summary}`,
                        ephemeral: true,
                    });
                    return;
                }
            }
        } catch (error) {
            console.error('Error handling interaction:', error);

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while processing your interaction!', flags: MessageFlags.Ephemeral }).catch(() => { });
            } else {
                await interaction.reply({ content: 'There was an error while processing your interaction!', flags: MessageFlags.Ephemeral }).catch(() => { });
            }
        }
    },
};
