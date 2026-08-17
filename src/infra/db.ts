import { Pool } from 'pg';
import type { Config } from '../config';

// A small, bounded pool (see DESIGN.md §6): a large pool thrashes a 1-CPU Postgres
// statement_timeout caps pathological queries at the connection level
export function createPool(config: Config): Pool {
    return new Pool({
        connectionString: config.databaseUrl,
        max: config.dbPoolSize,
        statement_timeout: config.statementTimeoutMs,
    });
}

// Postgres may still be coming up when the app starts, so retry briefly
export async function verifyConnection(
    pool: Pool,
    retries = 10,
    delayMs = 1000,
): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (err) {
            if (attempt === retries) throw err;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}
