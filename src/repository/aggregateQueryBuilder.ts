import type { AggregationQuery, QueryFilter, BucketSize, GroupBy } from '../domain/types';
import { buildWhereConditions, createParamBag, type BuiltQuery } from './queryBuilder';

// Builds the parameterized aggregation SQL using date_bin() for fixed-origin
// time bucketing (see DESIGN.md §6). Reuses the shared WHERE builder so the
// same filters + the same SQL-injection-safe construction apply.

// Fixed bucket-alignment origin (see decision in this step): buckets align to
// natural boundaries (minutes on the minute, days at UTC midnight), independent
// of `since`.
const BUCKET_ORIGIN = '2000-01-01T00:00:00Z';

// Map the contract's bucket tokens to Postgres interval literals.
const INTERVALS: Record<BucketSize, string> = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '1h': '1 hour',
    '1d': '1 day',
};

// group_by maps to a column name. Fixed allow-list -> safe to inline.
const GROUP_COLUMNS: Record<GroupBy, string> = {
    service: 'service',
    level: 'level',
};

export function buildAggregateQuery(agg: AggregationQuery): BuiltQuery {
    const bag = createParamBag();

    // Reuse the shared WHERE (service, level, since/until, attributes, q); no cursor.
    const filter: QueryFilter = {
        service: agg.service,
        level: agg.level,
        since: agg.since,
        until: agg.until,
        attributes: agg.attributes,
        q: agg.q,
        limit: 0, // unused here
    };
    const where = buildWhereConditions(filter, bag, { includeCursor: false });
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const interval = bag.add(INTERVALS[agg.bucket]); // e.g. '5 minutes'
    const origin = bag.add(BUCKET_ORIGIN);

    // group expression: a fixed column name (allow-list) or NULL when absent.
    const groupExpr = agg.groupBy ? GROUP_COLUMNS[agg.groupBy] : 'NULL::text';

    const sql = `
        SELECT date_bin(${interval}::interval, timestamp, ${origin}::timestamptz) AS bucket_start,
            ${groupExpr} AS grp,
            count(*)::bigint AS cnt
        FROM logs
        ${whereSql}
        GROUP BY bucket_start, grp
        ORDER BY bucket_start ASC
    `.trim();

    return { sql, params: bag.values };
}