require('dotenv').config();

const HealthCheck = require('../utils/healthcheck');

(async () => {
  try {
    const hc = new HealthCheck(process.env.HEALTHCHECK_URL, 5);
    console.log('HEALTHCHECK_URL is', process.env.HEALTHCHECK_URL ? 'set' : 'unset');

    console.log('Running DB check...');
    const dbOk = await hc._checkDb().catch((e) => {
      console.error('DB check threw:', e && e.message ? e.message : e);
      return false;
    });
    console.log('DB OK:', dbOk);

    if (process.env.HEALTHCHECK_URL) {
      console.log('Pinging health endpoint...');
      const pingOk = await hc._sendPing(dbOk).catch((e) => {
        console.error('Ping failed:', e && e.message ? e.message : e);
        return false;
      });
      console.log('Ping OK:', pingOk);
    } else {
      console.log('No HEALTHCHECK_URL configured, skipping ping.');
    }

    process.exit(dbOk ? 0 : 2);
  } catch (e) {
    console.error('Healthcheck test failed:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
