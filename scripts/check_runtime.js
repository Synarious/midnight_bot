// Simple runtime checker for discord.js features required by this project
try {
  const dj = require('discord.js');
  console.log('discord.js version:', dj.version || 'unknown');
  console.log('ContainerBuilder:', typeof dj.ContainerBuilder === 'function');
  console.log('TextDisplayBuilder:', typeof dj.TextDisplayBuilder === 'function');
  console.log('MessageFlags.IsComponentsV2:', !!(dj.MessageFlags && dj.MessageFlags.IsComponentsV2 !== undefined));
  console.log('MessageFlags.Ephemeral:', !!(dj.MessageFlags && dj.MessageFlags.Ephemeral !== undefined));
  process.exit(0);
} catch (e) {
  console.error('Runtime check failed:', e && e.message);
  process.exit(2);
}
