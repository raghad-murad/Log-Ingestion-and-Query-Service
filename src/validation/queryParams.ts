import type { QueryFilter, LogLevel } from '../domain/types';
import { decodeCursor, InvalidCursorError } from '../lib/cursor';

// Validates and parses GET /logs query parameters into a QueryFilter.
// Returns { ok:true, filter } or { ok:false, error } (route maps error -> 400).
// Only the contract's rules are enforced.

const LEVELS: ReadonlySet<string> = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const ATTR_PREFIX = 'attr.';

export type QueryValidation =
    | { ok: true; filter: QueryFilter }
    | { ok: false; error: string };

// Fastify gives us query values as string | string[] | undefined.
function single(value: unknown): string | undefined {
    if (Array.isArray(value)) return value[value.length - 1] as string; // last wins
    if (typeof value === 'string') return value;
    return undefined;
}

function isValidIso(value: string): boolean {
    return !Number.isNaN(Date.parse(value));
}

export function validateQueryParams(rawQuery: Record<string, unknown>): QueryValidation {
    const filter: QueryFilter = { attributes: {}, limit: DEFAULT_LIMIT };

    const service = single(rawQuery.service);
    if (service !== undefined) filter.service = service;

    const level = single(rawQuery.level);
    if (level !== undefined) {
        if (!LEVELS.has(level)) return { ok: false, error: `invalid level: '${level}'` };
        filter.level = level as LogLevel;
    }

    const since = single(rawQuery.since);
    if (since !== undefined) {
        if (!isValidIso(since)) return { ok: false, error: `invalid since timestamp: '${since}'` };
        filter.since = since;
    }

    const until = single(rawQuery.until);
    if (until !== undefined) {
        if (!isValidIso(until)) return { ok: false, error: `invalid until timestamp: '${until}'` };
        filter.until = until;
    }

    if (filter.since !== undefined && filter.until !== undefined) {
        if (Date.parse(filter.until) < Date.parse(filter.since)) {
        return { ok: false, error: 'until must not be earlier than since' };
        }
    }

    const q = single(rawQuery.q);
    if (q !== undefined) filter.q = q;

    const limitRaw = single(rawQuery.limit);
    if (limitRaw !== undefined) {
        if (!/^\d+$/.test(limitRaw)) return { ok: false, error: `invalid limit: '${limitRaw}'` };
        const limit = Number(limitRaw);
        if (limit < 1 || limit > MAX_LIMIT) {
        return { ok: false, error: `limit must be between 1 and ${MAX_LIMIT}` };
        }
        filter.limit = limit;
    }

    const cursor = single(rawQuery.cursor);
    if (cursor !== undefined) {
        try {
        filter.cursor = decodeCursor(cursor);
        } catch (err) {
        if (err instanceof InvalidCursorError) return { ok: false, error: 'invalid cursor' };
        throw err;
        }
    }

    // attr.<key>=value — collect every attr.* param (compared as strings).
    for (const [key, value] of Object.entries(rawQuery)) {
        if (key.startsWith(ATTR_PREFIX) && key.length > ATTR_PREFIX.length) {
        const attrKey = key.slice(ATTR_PREFIX.length);
        const attrValue = single(value);
        if (attrValue !== undefined) filter.attributes[attrKey] = attrValue;
        }
    }

    return { ok: true, filter };
}