import { join } from 'node:path';
import { loadConfig } from './config';
import { createPool, verifyConnection } from './infra/db';
import { runMigrations } from './infra/migrator';
import { ensurePartitions } from './repository/partitionManager';
import { createLogRepository } from './repository/logRepository';
import { createLogService } from './services/logService';
import { createReadiness } from './health/readiness';
import { buildServer } from './server';

// migrations/ lives at the project root, next to dist/ and src/
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
    const config = loadConfig();
    const readiness = createReadiness();
    const pool = createPool(config);

    // Wire the layers: repository -> service -> routes
    const logRepository = createLogRepository(pool);
    const logService = createLogService(logRepository);

    // Start the HTTP server first, so /health can report 503 during startup
    const app = buildServer({ readiness, logService });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`listening on :${config.port} (state=starting)`);

    // Startup sequence: /health stays 503 until this completes
    await verifyConnection(pool);
    app.log.info('database connection verified');

    const applied = await runMigrations(pool, MIGRATIONS_DIR);
    app.log.info(`migrations applied: ${applied.length ? applied.join(', ') : 'none (up to date)'}`);

    const partitions = await ensurePartitions(pool, config);
    app.log.info(`partitions ensured: ${partitions.length} (retention ${config.retentionDays}d + look-ahead)`);

    readiness.markReady();
    app.log.info('service ready (/health -> 200)');

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
        app.log.info(`received ${signal}, shutting down`);
        await app.close();
        await pool.end();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
    console.error('fatal startup error', err);
    process.exit(1);
});