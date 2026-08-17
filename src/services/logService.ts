import type { LogEntry, IngestResult, RejectedEntry } from '../domain/types';
import { validateLogEntry } from '../validation/logEntry';
import type { LogRepository } from '../repository/logRepository';

// Business logic for ingestion: validate each entry independently (partial
// acceptance), persist the valid ones, and build the per-entry result.
export interface LogService {
    ingest(rawLogs: unknown[]): Promise<IngestResult>;
}

export function createLogService(repository: LogRepository): LogService {
    return {
        async ingest(rawLogs: unknown[]): Promise<IngestResult> {
            const valid: LogEntry[] = [];
            const rejected: RejectedEntry[] = [];
            const now = Date.now();

            rawLogs.forEach((raw, index) => {
                const result = validateLogEntry(raw, now);
                if (result.ok) {
                    valid.push(result.entry);
                } else {
                    rejected.push({ index, reason: result.reason });
                }
            });

            // Only persist if there is something valid. The route decides the status
            // code based on accepted count.
            if (valid.length > 0) {
                await repository.insertBatch(valid);
            }

            return { accepted: valid.length, rejected };
        },
    };
}