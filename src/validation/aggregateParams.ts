import type { AggregationQuery, LogLevel, BucketSize, GroupBy } from '../domain/types';

// Validates GET /logs/aggregate params. since/until/bucket are REQUIRED here.
// Same filter rules as /logs for the shared fields.

const LEVELS: ReadonlySet<string> = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const BUCKETS: ReadonlySet<string> = new Set<BucketSize>(['1m', '5m', '1h', '1d']);
const GROUPS: ReadonlySet<string> = new Set<GroupBy>(['service', 'level']);
const ATTR_PREFIX = 'attr.';

export type AggregateValidation =
    | { ok: true; query: AggregationQuery }
    | { ok: false; error: string };

function single(value: unknown): string | undefined {
    if (Array.isArray(value)) return value[value.length - 1] as string;
    if (typeof value === 'string') return value;
    return undefined;
}

function isValidIso(value: string): boolean {
    return !Number.isNaN(Date.parse(value));
}

export function validateAggregateParams(rawQuery: Record<string, unknown>): AggregateValidation {
    // since (required)
    const since = single(rawQuery.since);
    if (since === undefined) return { ok: false, error: 'since is required' };
    if (!isValidIso(since)) return { ok: false, error: `invalid since timestamp: '${since}'` };

    // until (required)
    const until = single(rawQuery.until);
    if (until === undefined) return { ok: false, error: 'until is required' };
    if (!isValidIso(until)) return { ok: false, error: `invalid until timestamp: '${until}'` };

    if (Date.parse(until) < Date.parse(since)) {
        return { ok: false, error: 'until must not be earlier than since' };
    }

    // bucket (required)
    const bucket = single(rawQuery.bucket);
    if (bucket === undefined) return { ok: false, error: 'bucket is required' };
    if (!BUCKETS.has(bucket)) return { ok: false, error: `invalid bucket: '${bucket}' (use 1m, 5m, 1h, or 1d)` };

    const query: AggregationQuery = {
        since,
        until,
        bucket: bucket as BucketSize,
        attributes: {},
    };

    // group_by (optional)
    const groupBy = single(rawQuery.group_by);
    if (groupBy !== undefined) {
        if (!GROUPS.has(groupBy)) return { ok: false, error: `invalid group_by: '${groupBy}' (use service or level)` };
        query.groupBy = groupBy as GroupBy;
    }

    // shared filters
    const service = single(rawQuery.service);
    if (service !== undefined) query.service = service;

    const level = single(rawQuery.level);
    if (level !== undefined) {
        if (!LEVELS.has(level)) return { ok: false, error: `invalid level: '${level}'` };
        query.level = level as LogLevel;
    }

    const q = single(rawQuery.q);
    if (q !== undefined) query.q = q;

    for (const [key, value] of Object.entries(rawQuery)) {
        if (key.startsWith(ATTR_PREFIX) && key.length > ATTR_PREFIX.length) {
        const attrValue = single(value);
        if (attrValue !== undefined) query.attributes[key.slice(ATTR_PREFIX.length)] = attrValue;
        }
    }

    return { ok: true, query };
}