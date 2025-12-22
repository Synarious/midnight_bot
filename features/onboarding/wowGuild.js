const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

// ==================== ONBOARDING CONFIGURATION ====================
// Gate role that is removed when user completes verification
const GATE_ROLE_ID = '1442686627481911356';
const WOW_MEMBER_ROLE_ID = '1129313754778194050';
const WOW_WELCOME_CHANNEL_ID = '713412331761172506';
const WOW_LOG_CHANNEL_ID = '1443006368897306728';

// Guild/realm slugs can be overridden via env vars if you rename the guild or realm
const WOW_GUILD_REALM_SLUG = process.env.WOW_GUILD_REALM_SLUG || 'moon-guard';
const VERIFICATION_MODAL_ID = 'wow_guild_verification';

// Convenience override: set the 4-character guild code here for easy local changes.
// You can also set the env var WOW_ONBOARDING_CODE to override this value.
// Example: const WOW_ONBOARDING_CODE = 'AB12';
const WOW_ONBOARDING_CODE = process.env.WOW_ONBOARDING_CODE || 'GB16';

// Optional: restrict this feature to a set of guild IDs (comma-separated in env)
// If empty, the feature is enabled in all guilds.
const ALLOWED_GUILD_IDS = (process.env.WOW_ONBOARDING_GUILDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function isGuildAllowed(interaction) {
    if (!interaction || !interaction.guild) return false;
    if (ALLOWED_GUILD_IDS.length === 0) return true;
    return ALLOWED_GUILD_IDS.includes(interaction.guild.id);
}

function formatGuildInfo(interaction) {
    try {
        const g = interaction?.guild;
        if (!g) return '(no guild)';
        return `${g.name} (ID: ${g.id})`;
    } catch (e) {
        return '(unknown guild)';
    }
}

function getRandomWelcomeMessage(user) {
    const userMention = `<@${user.id}>`;
    const templates = [
        `Welcome ${userMention}! The Dawnbound gains a new champion — may your loot be plentiful.`,
        `Hey ${userMention}, fresh from Azeroth — may your quests be epic and your crits be high.`,
        `${userMention} has arrived at the guild hall — ready to queue for a dungeon?`,
        `Nice to see you ${userMention}! May your mounts be swift and your transmog legendary.`,
        `Welcome ${userMention}! Make yourself at the hearth — share your main and preferred spec when you can.`,
        `Hey ${userMention}, welcome aboard — hope you're ready for Mythic+ dungeons and world bosses.`,
        `Yo ${userMention}! Your avatar screams veteran — show us your best dungeon runs.`,
        `${userMention} — welcome! No need to introduce yourself, but let us know your class and role if you like.`,
        `Hi ${userMention}! That character name fits right in — may your runs be smooth.`,
        `Welcome ${userMention}! Quiet entry? Perfect — stealthy rogues and patient healers welcome.`,
        `Hey ${userMention}, glad you joined — bring potions and come dungeon night ready.`,
        `Welcome ${userMention}! If your name had a battlecry, we'd hear it across Azeroth.`,
        `Hi ${userMention}! Love the look — hope the Dawnbound feels like a second home.`,
        `Welcome ${userMention}! Your arrival strengthens our ranks — time for a dungeon push.`,
        `${userMention}, welcome! Whether you PvP, run dungeons, or collect mounts, you'll find allies here.`,
        `Hey ${userMention}, that avatar says "seasoned adventurer" — good to have you with us.`,
        `Welcome ${userMention}! No intro required, but drop your main and favourite dungeon if you want.`,
        `Nice to meet you ${userMention}! You look ready for heroic nights — enjoy the guild.`,
        `Welcome ${userMention}! If you want dungeon or gearing recs, ask any officer later.`,
        `Hey ${userMention}, subtle flex: great transmog. Welcome to the guild hall.`,
        `Welcome ${userMention}! Your name suggests a true looter — and we approve.`,
        `Hi ${userMention}! We appreciate a tasteful mount — swing by the tavern and say hi.`,
        `Welcome ${userMention}! Pop in when you feel like it — the guild hall's always open.`,
        `Hey ${userMention}, love the energy — ready for the next dungeon night?`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// ==================== INTERACTION HANDLERS ====================

/**
 * Handle onboarding finish button interaction
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleButton(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'wow_finish') return false;
    if (!isGuildAllowed(interaction)) return false;

    try {
        const modal = new ModalBuilder()
            .setCustomId(VERIFICATION_MODAL_ID)
            .setTitle('WoW Character Verification');

        const characterInput = new TextInputBuilder()
            .setCustomId('characterName')
            .setLabel('Character name')
            .setPlaceholder('Your WoW character name (this will become your nickname)')
            .setMinLength(2)
            .setMaxLength(32)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const codeInput = new TextInputBuilder()
            .setCustomId('guildCode')
            .setLabel('Member Code (4 characters)')
            .setPlaceholder(`Found within "Guild Info" in-game`)
            .setMinLength(4)
            .setMaxLength(4)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(characterInput),
            new ActionRowBuilder().addComponents(codeInput)
        );

        await interaction.showModal(modal);
        return true;

    } catch (err) {
        console.error('[onboarding] handleButton error:', err);
        return false;
    }
}

/**
 * Handle onboarding modal submission (character name verification)
 * @param {import('discord.js').ModalSubmitInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleModal(interaction) {
    if (!interaction.isModalSubmit() || interaction.customId !== VERIFICATION_MODAL_ID) return false;
    if (!isGuildAllowed(interaction)) return false;

    try {
        const characterRaw = (interaction.fields.getTextInputValue('characterName') || '').trim();
        const codeRaw = (interaction.fields.getTextInputValue('guildCode') || '').trim();

        if (!characterRaw) {
            await interaction.reply({ content: 'Please provide a character name.', ephemeral: true });
            return true;
        }

        if (!codeRaw || !/^[A-Za-z0-9]{4}$/.test(codeRaw)) {
            await interaction.reply({ content: `Member code (found in guild info in-game)`, ephemeral: true });
            return true;
        }

        if (codeRaw.toLowerCase() !== WOW_ONBOARDING_CODE.toLowerCase()) {
            await interaction.reply({ content: `❌ Incorrect member code. Please try again with the correct code.`, ephemeral: true });
            return true;
        }

        await interaction.deferReply({ ephemeral: true });

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        
        // Remove gate role
        const gateRoleId = GATE_ROLE_ID;
        if (gateRoleId && member.roles.cache.has(gateRoleId)) {
            try {
                await member.roles.remove(gateRoleId);
                console.log(`[wowGuild] Removed gate role ${gateRoleId} from ${interaction.user.tag}`);
            } catch (roleErr) {
                console.error('[wowGuild] Failed to remove gate role:', roleErr);
            }
        }

        // Set nickname to character name
        try {
            await member.setNickname(characterRaw);
            console.log(`[wowGuild] Set nickname to '${characterRaw}' for ${interaction.user.tag}`);
        } catch (nickErr) {
            console.error('[wowGuild] Failed to set nickname:', nickErr);
        }

        // Add WoW Member role
        if (WOW_MEMBER_ROLE_ID && !member.roles.cache.has(WOW_MEMBER_ROLE_ID)) {
            try {
                await member.roles.add(WOW_MEMBER_ROLE_ID);
                console.log(`[wowGuild] Added WoW Member role ${WOW_MEMBER_ROLE_ID} to ${interaction.user.tag}`);
            } catch (roleErr) {
                console.error('[wowGuild] Failed to add WoW Member role:', roleErr);
            }
        }

        // Send welcome message
        const welcomeChannelId = WOW_WELCOME_CHANNEL_ID;
        if (welcomeChannelId) {
            const welcomeChannel = interaction.guild.channels.cache.get(welcomeChannelId);
            if (welcomeChannel) {
                const welcomeMessage = getRandomWelcomeMessage(member.user);
                await welcomeChannel.send(welcomeMessage);
            }
        }

        // Log to WoW log channel
        const logChannelId = WOW_LOG_CHANNEL_ID;
        if (logChannelId) {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0x00FF7F)
                    .setTitle('✅ WoW Onboarding Completed')
                    .addFields(
                        { name: 'Discord Name', value: member.user.globalName || 'None', inline: true },
                        { name: 'Username', value: `@${member.user.username}`, inline: true },
                        { name: 'User ID', value: member.user.id, inline: true },
                        { name: 'Character Name', value: characterRaw, inline: true },
                        { name: 'Realm', value: WOW_GUILD_REALM_SLUG, inline: true },
                        { name: 'Member', value: member.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
        }

        await interaction.editReply({
            content: `✅ Welcome to the guild, **${characterRaw}**! Your nickname has been set and you now have access to the server.`,
        });

        return true;

    } catch (err) {
        console.error('[onboarding] handleModal error:', err);
        await interaction.reply({ content: '❌ There was an error processing your character name. Please try again.', ephemeral: true }).catch(() => 
            interaction.editReply({ content: '❌ There was an error processing your character name. Please try again.' }).catch(() => null)
        );
        return true;
    }
}

module.exports = {
    handleButton,
    handleModal,
    GATE_ROLE_ID,
    rateLimits: {
        button: 2000,
        modal: 5000,
    },
};

