import type { QueryFilter } from '../domain/types';

// Builds the parameterized SELECT for GET /logs (see DESIGN.md §6, §8).
//
// SECURITY: every user-supplied VALUE is a positional parameter ($1, $2, ...),
// never interpolated into SQL text. The one identifier-position value — an
// attribute KEY inside attributes->>'...' — cannot be a parameter (Postgres
// doesn't allow placeholders there), so it is escaped as a SQL string literal
// (single-quote doubling) and rejected if it contains control characters.
// This is the single, auditable SQL-construction boundary.

export interface BuiltQuery {
    sql: string;
    params: unknown[];
}

// Escape a string to be embedded inside a single-quoted SQL literal: ' -> ''.
function escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

// Reject attribute keys with characters that have no business in a JSON key here
// (null bytes / control chars). Defense-in-depth on top of the escaping above.
function assertSafeAttributeKey(key: string): void {
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(key)) {
        throw new Error('unsupported attribute key');
    }
}

// Builds SELECT ... with keyset predicate and LIMIT (limit + 1) for the n+1 trick.
export function buildLogQuery(filter: QueryFilter): BuiltQuery {
    const where: string[] = [];
    const params: unknown[] = [];

    const add = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
    };

    if (filter.since !== undefined) where.push(`timestamp >= ${add(filter.since)}`);
    if (filter.until !== undefined) where.push(`timestamp < ${add(filter.until)}`);
    if (filter.service !== undefined) where.push(`service = ${add(filter.service)}`);
    if (filter.level !== undefined) where.push(`level = ${add(filter.level)}`);

    for (const [key, value] of Object.entries(filter.attributes)) {
        assertSafeAttributeKey(key);
        // key is an escaped SQL literal; value is a parameter.
        where.push(`attributes->>'${escapeSqlLiteral(key)}' = ${add(value)}`);
    }

    if (filter.q !== undefined) {
        // ILIKE substring: wrap the (parameterized) value in % on both sides.
        where.push(`message ILIKE ${add(`%${filter.q}%`)}`);
    }

    if (filter.cursor !== undefined) {
        // Keyset: rows strictly "older" than the cursor in (timestamp DESC, id DESC).
        const ts = add(filter.cursor.timestamp);
        const id = add(filter.cursor.id);
        where.push(`(timestamp, id) < (${ts}, ${id})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    // Fetch limit + 1 to detect whether a next page exists (n+1 trick).
    const limitPlusOne = add(filter.limit + 1);

    const sql = `
        SELECT id, timestamp, level, service, message, attributes
        FROM logs
        ${whereSql}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${limitPlusOne}
    `.trim();

    return { sql, params };
}