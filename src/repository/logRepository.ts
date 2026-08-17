import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Pool } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { LogEntry } from '../domain/types';

// Persistence for logs. The only place that knows how logs are written.
//
// Ingestion uses COPY (the fastest bulk path, see DESIGN.md §1d) inside an
// explicit BEGIN/COPY/COMMIT transaction. COPY provides throughput; the durable
// COMMIT is the atomicity/durability boundary that lets the route return 200.
//
// The DB generates `id` (bigint IDENTITY), so we only stream the 5 provided columns.

// Escape one value for Postgres TEXT-format COPY.
// Rules: \ -> \\, tab -> \t, newline -> \n, carriage return -> \r.
function copyEscape(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// Build one TEXT-format COPY line: timestamp \t level \t service \t message \t attributes
function toCopyLine(entry: LogEntry): string {
    const cols = [
        entry.timestamp,
        entry.level,
        entry.service,
        entry.message,
        JSON.stringify(entry.attributes), // jsonb accepts a JSON string
    ].map(copyEscape);
    return cols.join('\t') + '\n';
}

export interface LogRepository {
    insertBatch(entries: LogEntry[]): Promise<void>;
}

export function createLogRepository(pool: Pool): LogRepository {
    return {
        async insertBatch(entries: LogEntry[]): Promise<void> {
        if (entries.length === 0) return;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const stream = client.query(
            copyFrom(
                `COPY logs (timestamp, level, service, message, attributes)
                FROM STDIN WITH (FORMAT text)`,
            ),
            );

            const source = Readable.from(entries.map(toCopyLine));
            await pipeline(source, stream);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
        },
    };
}