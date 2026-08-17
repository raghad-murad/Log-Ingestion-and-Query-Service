import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

// Applies numbered .sql migrations from the migrations/ directory in order.
// Each unapplied migration runs inside its own transaction; the applied version
// is recorded in schema_migrations so re-runs are idempotent.
//
// Simple on purpose: no migration framework, easy to read and demo.
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
    // Ensure the tracking table exists before we query it. This mirrors what
    // 0001 also does (IF NOT EXISTS), so ordering never breaks.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     text        PRIMARY KEY,
            applied_at  timestamptz NOT NULL DEFAULT now()
        );
    `);

    const applied = new Set<string>(
        (await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
            (r) => r.version,
        ),
    );

    const files = (await readdir(migrationsDir))
        .filter((f) => f.endsWith('.sql'))
        .sort(); // 0001_, 0002_, ... apply in lexical order

    const newlyApplied: string[] = [];

    for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) continue;

        const sql = await readFile(join(migrationsDir, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
            await client.query('COMMIT');
            newlyApplied.push(version);
        } catch (err) {
            await client.query('ROLLBACK');
            throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
        } finally {
            client.release();
        }
    }

    return newlyApplied;
}
