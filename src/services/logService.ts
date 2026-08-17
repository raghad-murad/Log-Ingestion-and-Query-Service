import type { LogEntry, IngestResult, RejectedEntry, QueryFilter, QueryResult } from '../domain/types';
import { validateLogEntry } from '../validation/logEntry';
import { encodeCursor } from '../lib/cursor';
import type { LogRepository } from '../repository/logRepository';

export interface LogService {
    ingest(rawLogs: unknown[]): Promise<IngestResult>;
    query(filter: QueryFilter): Promise<QueryResult>;
}

export function createLogService(repository: LogRepository): LogService {
    return {
        async ingest(rawLogs: unknown[]): Promise<IngestResult> {
            const valid: LogEntry[] = [];
            const rejected: RejectedEntry[] = [];
            const now = Date.now();

            rawLogs.forEach((raw, index) => {
                const result = validateLogEntry(raw, now);
                if (result.ok) valid.push(result.entry);
                else rejected.push({ index, reason: result.reason });
            });

            if (valid.length > 0) await repository.insertBatch(valid);
            return { accepted: valid.length, rejected };
        },

        async query(filter: QueryFilter): Promise<QueryResult> {
            // The repository returns up to limit + 1 rows (n+1 trick).
            const rows = await repository.find(filter);

            let nextCursor: string | null = null;
            if (rows.length > filter.limit) {
                // There is a next page. The extra row is the boundary; drop it and encode
                // the cursor from the LAST row we actually return.
                rows.length = filter.limit;
                const last = rows[rows.length - 1];
                nextCursor = encodeCursor({ timestamp: last.timestamp, id: last.id });
            }

            return { logs: rows, next_cursor: nextCursor };
        },
    };
}