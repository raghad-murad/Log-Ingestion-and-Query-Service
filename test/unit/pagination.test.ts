import { describe, it, expect } from 'vitest';
import { createLogService } from '../../src/services/logService';
import { decodeCursor } from '../../src/lib/cursor';
import type { LogRepository, LogRow } from '../../src/repository/logRepository';
import type { QueryFilter } from '../../src/domain/types';

function row(n: number): LogRow {
    return {
        id: String(n),
        timestamp: `2026-08-17T10:00:${String(n % 60).padStart(2, '0')}.000Z`,
        level: 'info', service: 'svc', message: `m${n}`, attributes: {},
    };
}

// Repository stub that returns a fixed set of rows regardless of filter.
function repoReturning(rows: LogRow[]): LogRepository {
    return {
        async insertBatch() {},
        async find() { return rows; },
        async aggregate() { return []; },
    };
}

const filter = (limit: number): QueryFilter => ({ attributes: {}, limit });

describe('query pagination (n+1 logic)', () => {
    it('returns all rows and a null cursor when fewer than limit', () => {
        const svc = createLogService(repoReturning([row(1), row(2)]));
        return svc.query(filter(100)).then((res) => {
        expect(res.logs.length).toBe(2);
        expect(res.next_cursor).toBeNull();
        });
    });

    it('returns null cursor when exactly limit rows (no extra row)', async () => {
        const rows = Array.from({ length: 100 }, (_, i) => row(i));
        const svc = createLogService(repoReturning(rows));
        const res = await svc.query(filter(100));
        expect(res.logs.length).toBe(100);
        expect(res.next_cursor).toBeNull();
    });

    it('trims to limit and sets a cursor when limit+1 rows returned', async () => {
        const rows = Array.from({ length: 101 }, (_, i) => row(i));
        const svc = createLogService(repoReturning(rows));
        const res = await svc.query(filter(100));
        expect(res.logs.length).toBe(100);
        expect(res.next_cursor).not.toBeNull();
    });

    it('builds the cursor from the last returned row (row index 99, not the extra row)', async () => {
        const rows = Array.from({ length: 101 }, (_, i) => row(i));
        const svc = createLogService(repoReturning(rows));
        const res = await svc.query(filter(100));
        const decoded = decodeCursor(res.next_cursor as string);
        expect(decoded.id).toBe('99');
        expect(decoded.timestamp).toBe(rows[99].timestamp);
    });
});