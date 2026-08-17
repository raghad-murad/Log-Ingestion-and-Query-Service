import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, InvalidCursorError } from '../../src/lib/cursor';

describe('CursorCodec', () => {
    it('round-trips timestamp + string id', () => {
        const cursor = { timestamp: '2026-08-17T11:00:00.000Z', id: '999' };
        const decoded = decodeCursor(encodeCursor(cursor));
        expect(decoded).toEqual(cursor);
    });

    it('round-trips a large bigint-as-string id', () => {
        const cursor = { timestamp: '2026-08-17T11:00:00.000Z', id: '9223372036854775807' };
        expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    });

    it('produces an opaque token (not the raw values)', () => {
        const token = encodeCursor({ timestamp: '2026-08-17T11:00:00.000Z', id: '1' });
        expect(token).not.toContain('2026');
        expect(token).not.toContain(':');
    });

    it('rejects malformed base64 / non-JSON', () => {
        expect(() => decodeCursor('not-valid!!')).toThrow(InvalidCursorError);
    });

    it('rejects a JSON payload with the wrong shape', () => {
        const bad = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
        expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
    });

    it('rejects a payload with an invalid timestamp', () => {
        const bad = Buffer.from(JSON.stringify({ t: 'nope', i: '1' }), 'utf8').toString('base64url');
        expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
    });

    it('rejects a payload with a non-numeric id', () => {
        const bad = Buffer.from(JSON.stringify({ t: '2026-08-17T11:00:00Z', i: 'abc' }), 'utf8').toString('base64url');
        expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
    });
});