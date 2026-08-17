import { join } from 'node:path';
import { loadConfig } from './config';
import { createPool, verifyConnection } from './infra/db';
import { runMigrations } from './infra/migrator';
import { ensurePartitions } from './repository/partitionManager';
import { createLogRepository } from './repository/logRepository';
import { createLogService } from './services/logService';
import { createRetentionService } from './services/retentionService';
import { createRetentionScheduler } from './scheduler/retentionScheduler';
import { createReadiness } from './health/readiness';
import { buildServer } from './server';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
    const config = loadConfig();
    const readiness = createReadiness();
    const pool = createPool(config);

    const logRepository = createLogRepository(pool);
    const logService = createLogService(logRepository);

    // Start the HTTP server first, so /health can report 503 during startup.
    const app = buildServer({ readiness, logService });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`listening on :${config.port} (state=starting)`);

    // Startup sequence, where /health stays 503 until this completes ---
    // Startup failures throw -> service never becomes ready (see main().catch).
    await verifyConnection(pool);
    app.log.info('database connection verified');

    const applied = await runMigrations(pool, MIGRATIONS_DIR);
    app.log.info(`migrations applied: ${applied.length ? applied.join(', ') : 'none (up to date)'}`);

    const partitions = await ensurePartitions(pool, config);
    app.log.info(`partitions ensured: ${partitions.length} (retention ${config.retentionDays}d + look-ahead)`);

    readiness.markReady();
    app.log.info('service ready (/health -> 200)');

    // Background retention maintenance (off the hot path)
    // First cycle runs immediately; failures are logged, not fatal.
    const retentionService = createRetentionService(pool, config, app.log);
    const retentionScheduler = createRetentionScheduler(
        retentionService,
        config.maintenanceIntervalMs,
        app.log,
    );
    retentionScheduler.start();

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
        app.log.info(`received ${signal}, shutting down`);
        retentionScheduler.stop();
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