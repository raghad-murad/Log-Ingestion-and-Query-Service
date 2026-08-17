import type { LogEntry, LogLevel, Attributes, AttrValue } from '../domain/types';

// Per-entry validation for POST /logs, matching the contract exactly.
// Hand-written (not a schema library) so we can:
//   * accumulate a reason per entry instead of throwing on the first error, and
//   * stay cheap on the hot path (see DESIGN.md §1).
//
// IMPORTANT: only the rules the spec states are enforced — no trimming, no max
// lengths, no extra rules invented here.

const LEVELS: ReadonlySet<string> = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Result of validating a single entry: either a normalized LogEntry or a reason.
export type EntryValidation =
    | { ok: true; entry: LogEntry }
    | { ok: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateAttributes(raw: unknown): { ok: true; value: Attributes } | { ok: false; reason: string } {
    if (raw === undefined) return { ok: true, value: {} }; // optional
    if (!isPlainObject(raw)) return { ok: false, reason: 'attributes must be an object' };

    const out: Attributes = {};
    for (const [key, value] of Object.entries(raw)) {
        const t = typeof value;
        if (t !== 'string' && t !== 'number' && t !== 'boolean') {
            // Covers nested objects, arrays, and null (typeof null === 'object').
            return { ok: false, reason: `attribute '${key}' must be a string, number, or boolean` };
        }
        out[key] = value as AttrValue;
    }
    return { ok: true, value: out };
}

export function validateLogEntry(raw: unknown, now: number = Date.now()): EntryValidation {
    if (!isPlainObject(raw)) return { ok: false, reason: 'entry must be an object' };

    // timestamp: required, valid ISO 8601, not more than 5 minutes in the future.
    const ts = raw.timestamp;
    if (typeof ts !== 'string') return { ok: false, reason: 'timestamp is required and must be a string' };
    const parsed = Date.parse(ts);
    if (Number.isNaN(parsed)) return { ok: false, reason: `invalid timestamp: '${ts}'` };
    if (parsed > now + FIVE_MINUTES_MS) {
        return { ok: false, reason: 'timestamp is more than five minutes in the future' };
    }

    // level: required, exactly one of the four.
    const level = raw.level;
    if (typeof level !== 'string' || !LEVELS.has(level)) {
        return { ok: false, reason: `invalid level: '${String(level)}'` };
    }

    // service: required, non-empty string.
    const service = raw.service;
    if (typeof service !== 'string' || service.length === 0) {
        return { ok: false, reason: 'service is required and must be a non-empty string' };
    }

    // message: required, non-empty string.
    const message = raw.message;
    if (typeof message !== 'string' || message.length === 0) {
        return { ok: false, reason: 'message is required and must be a non-empty string' };
    }

    // attributes: optional flat object of string|number|boolean.
    const attrs = validateAttributes(raw.attributes);
    if (!attrs.ok) return { ok: false, reason: attrs.reason };

    return {
        ok: true,
        entry: { timestamp: ts, level: level as LogLevel, service, message, attributes: attrs.value },
    };
}