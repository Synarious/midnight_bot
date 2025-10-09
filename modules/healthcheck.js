const https = require('https');

/**
 * HealthCheck module for pinging healthchecks.io
 * Monitors bot uptime by sending periodic pings to a healthcheck URL
 */
class HealthCheck {
  /**
   * @param {string} url - The healthcheck URL to ping
   * @param {number} intervalMinutes - How often to ping (in minutes)
   */
  constructor(url, intervalMinutes = 3) {
    this.url = url;
    this.interval = intervalMinutes * 60 * 1000; // Convert to milliseconds
    this.intervalId = null;
  }

  /**
   * Send a single ping to the healthcheck URL
   */
  ping() {
    if (!this.url) {
      console.log('No healthcheck URL configured, skipping ping');
      return;
    }

    https.get(this.url, (res) => {
      console.log(`✓ Healthcheck ping sent: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('✗ Healthcheck ping failed:', err.message);
    });
  }

  /**
   * Start sending periodic pings
   */
  start() {
    if (!this.url) {
      console.log('Healthcheck disabled: No URL provided');
      return;
    }

    console.log(`Starting healthcheck pings every ${this.interval / 60000} minutes to ${this.url}`);
    
    // Ping immediately on start
    this.ping();
    
    // Then ping at regular intervals
    this.intervalId = setInterval(() => this.ping(), this.interval);
  }

  /**
   * Stop sending pings
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Healthcheck pings stopped');
    }
  }
}

module.exports = HealthCheck;
