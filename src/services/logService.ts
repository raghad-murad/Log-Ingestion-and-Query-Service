import type { LogEntry, IngestResult, RejectedEntry, QueryFilter, QueryResult, AggregationQuery, AggregationResult, } from '../domain/types';
import { validateLogEntry } from '../validation/logEntry';
import { encodeCursor } from '../lib/cursor';
import type { LogRepository } from '../repository/logRepository';

export interface LogService {
    ingest(rawLogs: unknown[]): Promise<IngestResult>;
    query(filter: QueryFilter): Promise<QueryResult>;
    aggregate(agg: AggregationQuery): Promise<AggregationResult>;
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
            const rows = await repository.find(filter);
            let nextCursor: string | null = null;
            if (rows.length > filter.limit) {
                rows.length = filter.limit;
                const last = rows[rows.length - 1];
                nextCursor = encodeCursor({ timestamp: last.timestamp, id: last.id });
            }
            return { logs: rows, next_cursor: nextCursor };
        },

        async aggregate(agg: AggregationQuery): Promise<AggregationResult> {
            const buckets = await repository.aggregate(agg);
            return { buckets };
        },
    };
}