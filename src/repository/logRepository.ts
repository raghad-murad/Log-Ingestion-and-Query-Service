import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Pool } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { LogEntry, QueryFilter } from '../domain/types';
import { buildLogQuery } from './queryBuilder';

// A row as returned by GET /logs (id serialized as string; see DESIGN.md §7).
export interface LogRow {
    id: string;
    timestamp: string;
    level: string;
    service: string;
    message: string;
    attributes: Record<string, unknown>;
}

// COPY helpers (ingestion)
function copyEscape(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

function toCopyLine(entry: LogEntry): string {
    const cols = [
        entry.timestamp,
        entry.level,
        entry.service,
        entry.message,
        JSON.stringify(entry.attributes),
    ].map(copyEscape);
    return cols.join('\t') + '\n';
}

export interface LogRepository {
    insertBatch(entries: LogEntry[]): Promise<void>;
    // Returns up to (limit + 1) rows so the caller can detect a next page.
    find(filter: QueryFilter): Promise<LogRow[]>;
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

        async find(filter: QueryFilter): Promise<LogRow[]> {
            const { sql, params } = buildLogQuery(filter);
            // id is bigint; return it as text to preserve precision at the JS/API boundary.
            const { rows } = await pool.query(sql, params);
            return rows.map((r) => ({
                id: String(r.id),
                timestamp: new Date(r.timestamp).toISOString(),
                level: r.level,
                service: r.service,
                message: r.message,
                attributes: r.attributes,
            }));
        },
    };
}