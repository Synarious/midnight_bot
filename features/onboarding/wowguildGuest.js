const { ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getWowGuestSettings } = require('../../data/automodSettings');

// ==================== DEFAULT CONFIGURATION ====================
const DEFAULT_GATE_ROLE_ID = '1442686627481911356';
const DEFAULT_GUEST_ROLE_ID = '1130301984935780483';
const DEFAULT_WELCOME_CHANNEL_ID = '1445186684810563737';
const DEFAULT_LOG_CHANNEL_ID = '1130635039466586132';

const VERIFICATION_MODAL_ID = 'wow_guest_char_modal';

// Default welcome messages
const DEFAULT_WELCOME_MESSAGES = [
    `Welcome {user}! The Dawnbound gains a new champion — may your loot be plentiful.`,
    `Hey {user}, fresh from Azeroth — may your quests be epic and your crits be high.`,
    `{user} has arrived at the guild hall — ready to queue for a dungeon?`,
    `Nice to see you {user}! May your mounts be swift and your transmog legendary.`,
    `Welcome {user}! Make yourself at the hearth — share your main and preferred spec when you can.`,
    `Hey {user}, welcome aboard — hope you're ready for Mythic+ dungeons and world bosses.`,
    `Yo {user}! Your avatar screams veteran — show us your best dungeon runs.`,
    `{user} — welcome! No need to introduce yourself, but let us know your class and role if you like.`,
    `Hi {user}! That character name fits right in — may your runs be smooth.`,
    `Welcome {user}! Quiet entry? Perfect — stealthy rogues and patient healers welcome.`,
    `Hey {user}, glad you joined — bring potions and come dungeon night ready.`,
    `Welcome {user}! If your name had a battlecry, we'd hear it across Azeroth.`,
    `Hi {user}! Love the look — hope the Dawnbound feels like a second home.`,
    `Welcome {user}! Your arrival strengthens our ranks — time for a dungeon push.`,
    `{user}, welcome! Whether you PvP, run dungeons, or collect mounts, you'll find allies here.`,
    `Hey {user}, that avatar says "seasoned adventurer" — good to have you with us.`,
    `Welcome {user}! No intro required, but drop your main and favourite dungeon if you want.`,
    `Nice to meet you {user}! You look ready for heroic nights — enjoy the guild.`,
    `Welcome {user}! If you want dungeon or gearing recs, ask any officer later.`,
    `Hey {user}, subtle flex: great transmog. Welcome to the guild hall.`,
    `Welcome {user}! Your name suggests a true looter — and we approve.`,
    `Hi {user}! We appreciate a tasteful mount — swing by the tavern and say hi.`,
    `Welcome {user}! Pop in when you feel like it — the guild hall's always open.`,
    `Hey {user}, love the energy — ready for the next dungeon night?`
];

function getRandomWelcomeMessage(user, customMessages = null) {
    const userMention = `<@${user.id}>`;
    const templates = customMessages && customMessages.length > 0 ? customMessages : DEFAULT_WELCOME_MESSAGES;
    const template = templates[Math.floor(Math.random() * templates.length)];
    return template.replace(/{user}/g, userMention);
}

// ==================== INTERACTION HANDLERS ====================

/**
 * Handle onboarding finish button interaction
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleButton(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'wow_guest_finish') return false;
    if (!interaction.guild) return false;

    try {
        // Check if this guild has WoW guest onboarding enabled
        const settings = await getWowGuestSettings(interaction.guild.id);
        if (!settings || !settings.enabled) return false;

        const modal = new ModalBuilder()
            .setCustomId(VERIFICATION_MODAL_ID)
            .setTitle('WoW Character Name');

        const characterInput = new TextInputBuilder()
            .setCustomId('characterName')
            .setLabel('Character name')
            .setPlaceholder('Your WoW character name (this will become your nickname)')
            .setMinLength(2)
            .setMaxLength(32)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(characterInput)
        );

        await interaction.showModal(modal);
        return true;

    } catch (err) {
        console.error('[wowguestGuest] handleButton error:', err);
        return false;
    }
}

/**
 * Handle modal submission for character name
 * @param {import('discord.js').ModalSubmitInteraction} interaction 
 * @returns {Promise<boolean>} true if handled
 */
async function handleModal(interaction) {
    if (!interaction.isModalSubmit() || interaction.customId !== VERIFICATION_MODAL_ID) return false;
    if (!interaction.guild) return false;

    try {
        // Get guild settings from database
        const settings = await getWowGuestSettings(interaction.guild.id);
        if (!settings || !settings.enabled) return false;

        const characterRaw = (interaction.fields.getTextInputValue('characterName') || '').trim();

        if (!characterRaw) {
            await interaction.reply({ content: 'Please provide a character name.', ephemeral: true });
            return true;
        }

        await interaction.deferReply({ ephemeral: true });

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        
        // Remove gate role
        const gateRoleId = settings.gate_role_id || DEFAULT_GATE_ROLE_ID;
        if (gateRoleId && member.roles.cache.has(gateRoleId)) {
            try {
                await member.roles.remove(gateRoleId);
                console.log(`[wowGuildGuest] Removed gate role ${gateRoleId} from ${interaction.user.tag}`);
            } catch (roleErr) {
                console.error('[wowGuildGuest] Failed to remove gate role:', roleErr);
            }
        }

        // Set nickname to character name
        try {
            await member.setNickname(characterRaw);
            console.log(`[wowGuildGuest] Set nickname to '${characterRaw}' for ${interaction.user.tag}`);
        } catch (nickErr) {
            console.error('[wowGuildGuest] Failed to set nickname:', nickErr);
        }

        // Add Guest role
        const guestRoleId = settings.guest_role_id || DEFAULT_GUEST_ROLE_ID;
        if (guestRoleId && !member.roles.cache.has(guestRoleId)) {
            try {
                await member.roles.add(guestRoleId);
                console.log(`[wowGuildGuest] Added Guest role ${guestRoleId} to ${interaction.user.tag}`);
            } catch (roleErr) {
                console.error('[wowGuildGuest] Failed to add Guest role:', roleErr);
            }
        }

        // Send welcome message
        const welcomeChannelId = settings.welcome_channel_id || DEFAULT_WELCOME_CHANNEL_ID;
        if (welcomeChannelId) {
            const welcomeChannel = interaction.guild.channels.cache.get(welcomeChannelId);
            if (welcomeChannel) {
                const customMessages = parseJsonArray(settings.welcome_messages);
                const welcomeMessage = getRandomWelcomeMessage(member.user, customMessages);
                await welcomeChannel.send(welcomeMessage);
            }
        }

        // Log to WoW log channel
        const logChannelId = settings.log_channel_id || DEFAULT_LOG_CHANNEL_ID;
        if (logChannelId) {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('✅ Guest Onboarding Completed')
                    .addFields(
                        { name: 'Discord Name', value: member.user.globalName || 'None', inline: true },
                        { name: 'Username', value: `@${member.user.username}`, inline: true },
                        { name: 'User ID', value: member.user.id, inline: true },
                        { name: 'Character Name', value: characterRaw, inline: true },
                        { name: 'Nickname Set', value: member.nickname || characterRaw, inline: true },
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
        console.error('[wowGuildGuest] handleModal error:', err);
        await interaction.reply({ content: '❌ There was an error processing your character name. Please try again.', ephemeral: true }).catch(() => 
            interaction.editReply({ content: '❌ There was an error processing your character name. Please try again.' }).catch(() => null)
        );
        return true;
    }
}

function parseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// ==================== EXPORTS ====================

module.exports = {
    handleButton,
    handleModal,
    GATE_ROLE_ID: DEFAULT_GATE_ROLE_ID,
    rateLimits: {
        button: 2000,
        modal: 5000,
    },
};

