import { loadConfig } from './config';
import { createPool, verifyConnection } from './infra/db';
import { createReadiness } from './health/readiness';
import { buildServer } from './server';

async function main(): Promise<void> {

    // Load configuration and initialize readiness state
    const config = loadConfig();
    const readiness = createReadiness();

    // Start the HTTP server first, so /health can report 503 during startup
    const app = buildServer({ readiness });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`listening on :${config.port} (state=starting)`);

    // Startup sequence, where /health stays 503 until this completes
    const pool = createPool(config);
    await verifyConnection(pool);
    app.log.info('database connection verified');

    // Step B will insert here, before markReady():
    // await runMigrations(pool);
    // await ensurePartitions(pool, config);

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
