/**
 * Partition Management - Automatic partition creation for activity_log table
 * Ensures partitions exist for current and future months
 */

const pool = require('./database');
const cron = require('node-cron');

const partitionManager = {
    /**
     * Create a partition for a specific month
     */
    async createPartition(year, month) {
        try {
            const partitionName = `activity_log_y${year}m${month.toString().padStart(2, '0')}`;
            
            // Check if partition already exists
            const checkResult = await pool.query(
                `SELECT 1 FROM activity_log_partitions WHERE partition_name = $1`,
                [partitionName]
            );
            
            if (checkResult.rows.length > 0) {
                console.log(`[PartitionManager] Partition ${partitionName} already exists`);
                return true;
            }
            
            // Calculate date range
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 1);
            
            const startDateStr = startDate.toISOString().split('T')[0];
            const endDateStr = endDate.toISOString().split('T')[0];
            
            // Create partition
            await pool.query(`
                CREATE TABLE IF NOT EXISTS ${partitionName} 
                PARTITION OF activity_log
                FOR VALUES FROM ('${startDateStr}') TO ('${endDateStr}')
            `);
            
            // Record partition creation
            await pool.query(
                `INSERT INTO activity_log_partitions (partition_name, start_date, end_date)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (partition_name) DO NOTHING`,
                [partitionName, startDate, endDate]
            );
            
            console.log(`[PartitionManager] Created partition: ${partitionName} (${startDateStr} to ${endDateStr})`);
            return true;
        } catch (error) {
            console.error(`[PartitionManager] Error creating partition for ${year}-${month}:`, error);
            return false;
        }
    },

    /**
     * Ensure partitions exist for the next N months
     */
    async ensureFuturePartitions(monthsAhead = 2) {
        try {
            const now = new Date();
            
            for (let i = 0; i <= monthsAhead; i++) {
                const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
                const year = targetDate.getFullYear();
                const month = targetDate.getMonth() + 1;
                
                await this.createPartition(year, month);
            }
            
            console.log(`[PartitionManager] Ensured partitions exist for next ${monthsAhead} months`);
        } catch (error) {
            console.error('[PartitionManager] Error ensuring future partitions:', error);
        }
    },

    /**
     * Drop old partitions (older than retention period)
     */
    async dropOldPartitions(retentionMonths = 12) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
            
            const result = await pool.query(
                `SELECT partition_name FROM activity_log_partitions
                 WHERE start_date < $1
                 ORDER BY start_date ASC`,
                [cutoffDate]
            );
            
            for (const row of result.rows) {
                const partitionName = row.partition_name;
                
                try {
                    await pool.query(`DROP TABLE IF EXISTS ${partitionName}`);
                    await pool.query(
                        `DELETE FROM activity_log_partitions WHERE partition_name = $1`,
                        [partitionName]
                    );
                    
                    console.log(`[PartitionManager] Dropped old partition: ${partitionName}`);
                } catch (error) {
                    console.error(`[PartitionManager] Error dropping partition ${partitionName}:`, error);
                }
            }
        } catch (error) {
            console.error('[PartitionManager] Error dropping old partitions:', error);
        }
    },

    /**
     * List all existing partitions
     */
    async listPartitions() {
        try {
            const result = await pool.query(
                `SELECT * FROM activity_log_partitions ORDER BY start_date ASC`
            );
            
            return result.rows;
        } catch (error) {
            console.error('[PartitionManager] Error listing partitions:', error);
            return [];
        }
    },

    /**
     * Get partition stats
     */
    async getPartitionStats() {
        try {
            const result = await pool.query(`
                SELECT 
                    schemaname,
                    tablename,
                    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                    pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
                FROM pg_tables
                WHERE tablename LIKE 'activity_log_y%'
                ORDER BY size_bytes DESC
            `);
            
            return result.rows;
        } catch (error) {
            console.error('[PartitionManager] Error getting partition stats:', error);
            return [];
        }
    },

    /**
     * Start automatic partition management
     */
    startWorker() {
        console.log('[PartitionManager] Starting partition management worker...');
        
        // Ensure partitions exist on startup
        this.ensureFuturePartitions(2);
        
        // Check daily at midnight
        cron.schedule('0 0 * * *', async () => {
            await this.ensureFuturePartitions(2);
        });
        
        // Clean up old partitions monthly (on the 1st at 2 AM)
        cron.schedule('0 2 1 * *', async () => {
            await this.dropOldPartitions(12); // Keep 12 months
        });
    }
};

module.exports = partitionManager;
