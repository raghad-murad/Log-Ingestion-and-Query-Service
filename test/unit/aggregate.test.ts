import { describe, it, expect } from 'vitest';
import { buildAggregateQuery } from '../../src/repository/aggregateQueryBuilder';
import type { AggregationQuery } from '../../src/domain/types';

const base: AggregationQuery = {
    since: '2026-08-17T00:00:00Z', until: '2026-08-17T12:00:00Z',
    bucket: '1m', attributes: {},
};

describe('buildAggregateQuery', () => {
    it('uses date_bin with interval + origin parameters', () => {
        const { sql } = buildAggregateQuery(base);
        expect(sql).toMatch(/date_bin\(\$\d+::interval, timestamp, \$\d+::timestamptz\)/);
    });

    it('maps bucket tokens to Postgres intervals', () => {
        expect(buildAggregateQuery({ ...base, bucket: '1m' }).params).toContain('1 minute');
        expect(buildAggregateQuery({ ...base, bucket: '5m' }).params).toContain('5 minutes');
        expect(buildAggregateQuery({ ...base, bucket: '1h' }).params).toContain('1 hour');
        expect(buildAggregateQuery({ ...base, bucket: '1d' }).params).toContain('1 day');
    });

    it('uses a fixed bucket origin', () => {
        expect(buildAggregateQuery(base).params).toContain('2000-01-01T00:00:00Z');
    });

    it('groups by service when group_by=service', () => {
        expect(buildAggregateQuery({ ...base, groupBy: 'service' }).sql).toMatch(/service AS grp/);
    });

    it('groups by level when group_by=level', () => {
        expect(buildAggregateQuery({ ...base, groupBy: 'level' }).sql).toMatch(/level AS grp/);
    });

    it('uses NULL group when group_by is absent', () => {
        expect(buildAggregateQuery(base).sql).toMatch(/NULL::text AS grp/);
    });

    it('orders by bucket start ascending (opposite of /logs)', () => {
        expect(buildAggregateQuery(base).sql).toMatch(/ORDER BY bucket_start ASC/);
    });

    it('applies shared filters parameterized (service, attr, q)', () => {
        const { sql, params } = buildAggregateQuery({
        ...base, service: 'checkout', attributes: { user_id: '42' }, q: 'declined',
        });
        expect(sql).toMatch(/service = \$\d+/);
        expect(params).toContain('checkout');
        expect(params).toContain('42');
        expect(params).toContain('%declined%');
    });

    it('neutralizes SQL injection via attribute key in aggregation too', () => {
        const { sql } = buildAggregateQuery({ ...base, attributes: { "a') OR '1'='1": 'v' } });
        expect(sql).toContain("attributes->>'a'') OR ''1''=''1'");
    });
});