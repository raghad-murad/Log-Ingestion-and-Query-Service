import type { QueryFilter } from '../domain/types';

// Builds parameterized SQL for GET /logs and shares its WHERE builder with
// GET /logs/aggregate (see DESIGN.md §6, §8).
//
// SECURITY: every user-supplied VALUE is a positional parameter ($1, $2, ...),
// never interpolated. The one identifier-position value — an attribute KEY inside
// attributes->>'...' — cannot be a parameter, so it is escaped as a SQL string
// literal (single-quote doubling) and rejected if it contains control characters.
// This is the single, auditable SQL-construction boundary, reused by both routes.

export interface BuiltQuery {
    sql: string;
    params: unknown[];
}

// A parameter accumulator so callers can keep adding params after the WHERE.
export interface ParamBag {
    add(value: unknown): string; // returns the "$n" placeholder
    values: unknown[];
}

export function createParamBag(): ParamBag {
    const values: unknown[] = [];
    return {
        values,
        add(value: unknown): string {
        values.push(value);
        return `$${values.length}`;
        },
    };
}

function escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

function assertSafeAttributeKey(key: string): void {
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(key)) {
        throw new Error('unsupported attribute key');
    }
}

// Which filter fields to include. /logs uses the cursor; /aggregate does not.
interface WhereOptions {
    includeCursor: boolean;
}

// Builds the shared WHERE conditions (without the leading "WHERE"), appending
// parameters to the given bag. Returns the list of conditions.
export function buildWhereConditions(
    filter: QueryFilter,
    bag: ParamBag,
    options: WhereOptions,
): string[] {
    const where: string[] = [];

    if (filter.since !== undefined) where.push(`timestamp >= ${bag.add(filter.since)}`);
    if (filter.until !== undefined) where.push(`timestamp < ${bag.add(filter.until)}`);
    if (filter.service !== undefined) where.push(`service = ${bag.add(filter.service)}`);
    if (filter.level !== undefined) where.push(`level = ${bag.add(filter.level)}`);

    for (const [key, value] of Object.entries(filter.attributes)) {
        assertSafeAttributeKey(key);
        where.push(`attributes->>'${escapeSqlLiteral(key)}' = ${bag.add(value)}`);
    }

    if (filter.q !== undefined) {
        where.push(`message ILIKE ${bag.add(`%${filter.q}%`)}`);
    }

    if (options.includeCursor && filter.cursor !== undefined) {
        const ts = bag.add(filter.cursor.timestamp);
        const id = bag.add(filter.cursor.id);
        where.push(`(timestamp, id) < (${ts}, ${id})`);
    }

    return where;
}

// GET /logs: SELECT with keyset predicate + LIMIT (limit + 1) for the n+1 trick.
export function buildLogQuery(filter: QueryFilter): BuiltQuery {
    const bag = createParamBag();
    const where = buildWhereConditions(filter, bag, { includeCursor: true });
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limitPlusOne = bag.add(filter.limit + 1);

    const sql = `
        SELECT id, timestamp, level, service, message, attributes
        FROM logs
        ${whereSql}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${limitPlusOne}
    `.trim();

    return { sql, params: bag.values };
}