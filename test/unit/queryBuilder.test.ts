import { describe, it, expect } from 'vitest';
import { buildLogQuery } from '../../src/repository/queryBuilder';
import type { QueryFilter } from '../../src/domain/types';

const empty: QueryFilter = { attributes: {}, limit: 100 };

describe('buildLogQuery', () => {
    it('builds no WHERE when there are no filters', () => {
        const { sql } = buildLogQuery(empty);
        expect(sql).not.toMatch(/WHERE/);
    });

    it('always orders by timestamp DESC, id DESC', () => {
        expect(buildLogQuery(empty).sql).toMatch(/ORDER BY timestamp DESC, id DESC/);
    });

    it('fetches limit + 1 (n+1 trick)', () => {
        const { params } = buildLogQuery({ ...empty, limit: 100 });
        expect(params).toContain(101);
    });

    it('adds service as a parameter', () => {
        const { sql, params } = buildLogQuery({ ...empty, service: 'checkout' });
        expect(sql).toMatch(/service = \$\d+/);
        expect(params).toContain('checkout');
    });

    it('adds level as a parameter', () => {
        const { sql, params } = buildLogQuery({ ...empty, level: 'error' });
        expect(sql).toMatch(/level = \$\d+/);
        expect(params).toContain('error');
    });

    it('adds since (>=) and until (<) as parameters', () => {
        const { sql, params } = buildLogQuery({ ...empty, since: 'A', until: 'B' });
        expect(sql).toMatch(/timestamp >= \$\d+/);
        expect(sql).toMatch(/timestamp < \$\d+/);
        expect(params).toContain('A');
        expect(params).toContain('B');
    });

    it('joins multiple attributes with AND, values parameterized', () => {
        const { sql, params } = buildLogQuery({ ...empty, attributes: { user_id: '42', region: 'eu' } });
        expect(sql).toContain("attributes->>'user_id' = $");
        expect(sql).toContain("attributes->>'region' = $");
        expect(params).toContain('42');
        expect(params).toContain('eu');
        // value must NOT appear as an inline literal
        expect(sql).not.toMatch(/= '42'/);
    });

    it('wraps q with % and parameterizes it', () => {
        const { params } = buildLogQuery({ ...empty, q: 'declined' });
        expect(params).toContain('%declined%');
    });

    it('adds the keyset predicate when a cursor is present', () => {
        const { sql, params } = buildLogQuery({
        ...empty,
        cursor: { timestamp: '2026-08-17T11:00:00Z', id: '999' },
        });
        expect(sql).toMatch(/\(timestamp, id\) < \(\$\d+, \$\d+\)/);
        expect(params).toContain('999');
    });

    it('combines all filters into one parameterized query', () => {
        const { sql, params } = buildLogQuery({
        since: 'S', until: 'U', service: 'checkout', level: 'error',
        attributes: { user_id: '42' }, q: 'x', limit: 5,
        cursor: { timestamp: 'T', id: '7' },
        });
        // every $n placeholder should have a corresponding param
        const placeholders = (sql.match(/\$\d+/g) ?? []).map((p) => Number(p.slice(1)));
        expect(Math.max(...placeholders)).toBe(params.length);
    });

    it('neutralizes SQL injection via an attribute key (single-quote doubling)', () => {
        const { sql, params } = buildLogQuery({ ...empty, attributes: { "x') OR '1'='1": 'v' } });
        // the malicious quote is doubled, so it stays inside the string literal
        expect(sql).toContain("attributes->>'x'') OR ''1''=''1'");
        expect(params).toContain('v');
    });
});