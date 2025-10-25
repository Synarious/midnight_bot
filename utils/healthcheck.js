const { pool } = require('../data/database');
const axios = require('axios');

class HealthCheck {
  constructor(url, intervalSeconds = 10) {
    this.url = typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
    this.intervalMs = Math.max(1000, (intervalSeconds || 10) * 1000);
    this.timer = null;
    this.started = false;
  }

  async _checkDb() {
    try {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT 1 as ok');
        const val = res && res.rows && res.rows[0] ? res.rows[0].ok : null;
        return Number(val) === 1 || val === true || val === '1';
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('[Healthcheck] DB check failed:', e && e.message);
      return false;
    }
  }

  async _sendPing(ok) {
    if (!this.url) return false;

    // Normalize URL (remove trailing slashes)
    let base = this.url.replace(/\/+$/, '');
    const pingUrl = ok ? base : `${base}/fail`;

    try {
      const res = await axios.get(pingUrl, { timeout: 5000 });
      if (res && res.status >= 200 && res.status < 300) {
        console.log(`[Healthcheck] Pinged ${ok ? 'success' : 'failure'} endpoint: ${pingUrl} (${res.status})`);
        return true;
      }
      console.warn(`[Healthcheck] Unexpected response pinging ${pingUrl}: ${res && res.status}`);
      return false;
    } catch (err) {
      console.error(`[Healthcheck] Failed to send ping to ${pingUrl}:`, err && err.message);
      return false;
    }
  }

  start() {
    if (this.started) return;
    this.started = true;

    const runCheck = async () => {
      const ok = await this._checkDb().catch(() => false);
      if (!ok) {
        console.warn('[Healthcheck] DB check returned unhealthy');
      }

      // Notify external healthcheck service (if configured)
      if (this.url) {
        await this._sendPing(ok).catch((e) => {
          console.error('[Healthcheck] Error while notifying health endpoint:', e && e.message);
        });
      }
    };

    // Run an immediate check, then schedule periodic checks
    runCheck().catch((e) => console.error('[Healthcheck] Initial health check failed:', e && e.message));

    this.timer = setInterval(() => {
      runCheck().catch((e) => console.error('[Healthcheck] Scheduled health check failed:', e && e.message));
    }, this.intervalMs);

    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Optionally notify the external service that we're pausing/stopping
    if (this.started && this.url) {
      try {
        const pauseUrl = this.url.replace(/\/+$/, '') + '/pause';
        axios.get(pauseUrl, { timeout: 3000 }).catch(() => {});
      } catch (e) {
        // ignore
      }
    }

    this.started = false;
  }
}

module.exports = HealthCheck;
