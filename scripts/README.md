This folder contains small helper scripts for runtime checks.

check_runtime.js: A quick node script that prints which discord.js features are available in the installed runtime.

Usage:

```bash
node scripts/check_runtime.js
```

If any required features are missing, the script exits with a non-zero code and prints a helpful message.
