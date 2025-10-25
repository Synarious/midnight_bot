const { SlashCommandBuilder } = require('discord.js');
const db = require('../../data/database.js');
const rateLimiter = require('../../utils/rateLimiter.js');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another member')
    .addUserOption(opt => opt.setName('target').setDescription('Member to rob').setRequired(true)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const targetUser = interaction.options.getUser('target');

    if (!guildId) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    if (!targetUser) return interaction.reply({ content: 'Specify someone to rob.', ephemeral: true });
    if (targetUser.id === userId) return interaction.reply({ content: 'You cannot rob yourself.', ephemeral: true });

  // Enforce rate limiting for slash command usage (commandHandler will handle the prefix-adapter path)
  const rl = rateLimiter.checkRateLimit(userId, 'rob', module.exports.rateLimit);
  if (rl.limited) return rateLimiter.sendRateLimitResponse(interaction, rl.remainingMs, '/rob');
    try {
      // Load target balances
      const { rows: targetRows } = await db.query('SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2', [guildId, targetUser.id], { rateKey: guildId, context: 'eco:rob:select_target' });
      const target = targetRows[0] || { wallet: 0, bank: 0 };

      // Determine stealable amount: up to 33% wallet or 10% bank (whichever is higher)
      const stealableFromWallet = Math.floor(Number(target.wallet || 0) * 0.33);
      const stealableFromBank = Math.floor(Number(target.bank || 0) * 0.10);
      const maxSteal = Math.max(stealableFromWallet, stealableFromBank, 0);

      if (maxSteal <= 0) return interaction.reply({ content: 'Target has nothing worth stealing.', ephemeral: true });

      const taken = randomInt(1, maxSteal);
      const success = Math.random() < 0.45; // around 45% success

      if (success) {
        // prefer taking from wallet first
        let takenFromWallet = Math.min(Number(target.wallet || 0), taken);
        let takenFromBank = taken - takenFromWallet;

        // Update target and attacker
        await db.query('BEGIN', [], { rateKey: guildId, context: 'eco:rob:tx' });
        try {
          if (takenFromWallet > 0) {
            await db.query(
              `UPDATE guild_economy SET wallet = GREATEST(0, wallet - $1), updated_at = NOW() WHERE guild_id = $2 AND user_id = $3`,
              [takenFromWallet, guildId, targetUser.id],
              { rateKey: guildId, context: 'eco:rob:update_target_wallet' }
            );
          }

          if (takenFromBank > 0) {
            await db.query(
              `UPDATE guild_economy SET bank = GREATEST(0, bank - $1), updated_at = NOW() WHERE guild_id = $2 AND user_id = $3`,
              [takenFromBank, guildId, targetUser.id],
              { rateKey: guildId, context: 'eco:rob:update_target_bank' }
            );
          }

          await db.query(
            `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
             ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = guild_economy.wallet + $3, updated_at = NOW()`,
            [guildId, userId, taken, 0],
            { rateKey: guildId, context: 'eco:rob:update_attacker' }
          );

          await db.query('COMMIT', [], { rateKey: guildId, context: 'eco:rob:commit' });
        } catch (err) {
          await db.query('ROLLBACK', [], { rateKey: guildId, context: 'eco:rob:rollback' });
          throw err;
        }

        await interaction.reply({ content: `🏴 You successfully robbed ${targetUser.username} and took $${taken}!` });
      } else {
        // penalty: take 33% wallet or 10% bank from attacker as punishment (whichever is higher)
        const { rows: selfRows } = await db.query('SELECT wallet, bank FROM guild_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId], { rateKey: guildId, context: 'eco:rob:select_self' });
        const self = selfRows[0] || { wallet: 0, bank: 0 };

        const walletPenalty = Math.floor(Number(self.wallet || 0) * 0.33);
        const bankPenalty = Math.floor(Number(self.bank || 0) * 0.10);
        const penalty = Math.max(walletPenalty, bankPenalty, 0);

        if (penalty > 0) {
          const walletAfter = Math.max(0, Number(self.wallet || 0) - penalty);
          const bankAfter = Number(self.bank || 0);

          await db.query(
            `INSERT INTO guild_economy (guild_id, user_id, wallet, bank) VALUES ($1, $2, $3, $4)
             ON CONFLICT (guild_id, user_id) DO UPDATE SET wallet = $3, bank = $4, updated_at = NOW()`,
            [guildId, userId, walletAfter, bankAfter],
            { rateKey: guildId, context: 'eco:rob:penalty' }
          );
        }

        await interaction.reply({ content: `🚓 The robbery failed and you were fined $${penalty}.` });
      }
    } catch (error) {
      console.error('rob error', error);
      await interaction.reply({ content: 'Rob failed due to an internal error.', ephemeral: true });
    }
  },

  // 24 hour limit
  rateLimit: 24 * 60 * 60 * 1000,
};
