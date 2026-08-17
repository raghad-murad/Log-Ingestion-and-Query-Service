// Application configuration, read from environment variables with typed defaults.
// A bare `docker compose up` provides everything the service needs.

export interface Config {
    port: number;
    databaseUrl: string;
    retentionDays: number;
    dbPoolSize: number;
    statementTimeoutMs: number;
    maintenanceIntervalMs: number;
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function numberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid number for ${name}: "${raw}"`);
    return parsed;
}

export function loadConfig(): Config {
    return {
        port: numberEnv('PORT', 8080),
        databaseUrl: requiredEnv('DATABASE_URL'),
        retentionDays: numberEnv('RETENTION_DAYS', 30),
        dbPoolSize: numberEnv('DB_POOL_SIZE', 8),
        statementTimeoutMs: numberEnv('STATEMENT_TIMEOUT_MS', 2000),
        maintenanceIntervalMs: numberEnv('MAINTENANCE_INTERVAL_MS', 3_600_000), // 1 hour
    };
}