const { Events, EmbedBuilder } = require('discord.js');
const database = require('../../data/database');

function sanitizeForCodeBlock(text) {
	if (!text) return '';
	// Prevent breaking out of code blocks
	return String(text).replace(/```/g, '``\u200b`');
}

function formatContentForField(text) {
	if (!text) return '*(No text content)*';

	const sanitized = sanitizeForCodeBlock(text);
	// Keep well under 1024 after adding fences
	const maxInner = 1000;
	const truncated = sanitized.length > maxInner
		? `${sanitized.slice(0, maxInner - 3)}...`
		: sanitized;

	return `\`\`\`\n${truncated}\n\`\`\``;
}

module.exports = {
	name: Events.MessageUpdate,
	once: false,
	async execute(oldMessage, newMessage) {
		// Ignore DMs
		if (!newMessage.guild) return;

		// Best-effort resolve partials
		try {
			if (newMessage.partial) {
				newMessage = await newMessage.fetch();
			}
		} catch {
			// If we can't fetch, continue with what we have
		}

		// Ignore bots
		if (newMessage.author?.bot) return;

		const oldContent = oldMessage?.content || '';
		const newContent = newMessage?.content || '';

		// Only log actual content edits (skip embeds/pin updates/etc.)
		if (oldContent === newContent) return;

		let logChannelId = null;
		try {
			const settings = await database.getGuildSettings(newMessage.guild.id);
			logChannelId = database.resolveEnabledLogChannelId(settings, 'ch_editedmessages');
		} catch {
			// fail-open
		}

		if (!logChannelId) return;

		const logChannel = await newMessage.guild.channels.fetch(logChannelId).catch(() => null);
		if (!logChannel) return;

		const authorTag = newMessage.author?.tag || 'Unknown';
		const authorId = newMessage.author?.id || 'Unknown';
		const channelId = newMessage.channel?.id || 'Unknown';

		const embed = new EmbedBuilder()
			.setColor(0x6379d3)
			.setAuthor({
				name: '✏️ Message Edited',
				iconURL: newMessage.author?.displayAvatarURL?.() || null,
			})
			.setDescription(
				[
					`<@${authorId}> | ${authorTag} **In:** <#${channelId}>`,
					newMessage.url ? `[Jump to Context](${newMessage.url})` : null,
				]
					.filter(Boolean)
					.join(' | ')
			)
			.addFields(
				{ name: 'Before', value: formatContentForField(oldContent) },
				{ name: 'After', value: formatContentForField(newContent) }
			)
			.setTimestamp();

		await logChannel.send({ embeds: [embed] }).catch(err => {
			console.error(`[sl_messageEdit] Failed to send edit log to channel ${logChannelId} for guild ${newMessage.guild.id}:`, err);
		});
	},
};
