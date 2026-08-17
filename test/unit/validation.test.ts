import { describe, it, expect } from 'vitest';
import { validateLogEntry } from '../../src/validation/logEntry';

const NOW = Date.parse('2026-08-17T12:00:00Z');
const base = { timestamp: '2026-08-17T11:00:00Z', level: 'info', service: 'auth', message: 'ok' };

describe('validateLogEntry', () => {
    it('accepts a valid full entry', () => {
        const r = validateLogEntry(
        { ...base, level: 'error', attributes: { user_id: '42', retries: 3, active: true } },
        NOW,
        );
        expect(r.ok).toBe(true);
    });

    it('accepts a valid entry with no attributes (optional)', () => {
        expect(validateLogEntry(base, NOW).ok).toBe(true);
    });

    it('rejects a missing timestamp', () => {
        const { timestamp, ...noTs } = base;
        expect(validateLogEntry(noTs, NOW).ok).toBe(false);
    });

    it('rejects an invalid timestamp', () => {
        expect(validateLogEntry({ ...base, timestamp: 'not-a-date' }, NOW).ok).toBe(false);
    });

    it('rejects a timestamp more than 5 minutes in the future', () => {
        expect(validateLogEntry({ ...base, timestamp: '2026-08-17T12:06:00Z' }, NOW).ok).toBe(false);
    });

    it('accepts a timestamp less than 5 minutes in the future', () => {
        expect(validateLogEntry({ ...base, timestamp: '2026-08-17T12:04:00Z' }, NOW).ok).toBe(true);
    });

    it('rejects an invalid level', () => {
        expect(validateLogEntry({ ...base, level: 'critical' }, NOW).ok).toBe(false);
    });

    it('rejects a non-lowercase level (exact match)', () => {
        expect(validateLogEntry({ ...base, level: 'ERROR' }, NOW).ok).toBe(false);
    });

    it('rejects an empty service', () => {
        expect(validateLogEntry({ ...base, service: '' }, NOW).ok).toBe(false);
    });

    it('rejects an empty message', () => {
        expect(validateLogEntry({ ...base, message: '' }, NOW).ok).toBe(false);
    });

    it('accepts a whitespace service (non-empty literally, per contract)', () => {
        expect(validateLogEntry({ ...base, service: ' ' }, NOW).ok).toBe(true);
    });

    it('rejects nested object attributes', () => {
        expect(validateLogEntry({ ...base, attributes: { u: { id: 1 } } }, NOW).ok).toBe(false);
    });

    it('rejects array attribute values', () => {
        expect(validateLogEntry({ ...base, attributes: { roles: ['x'] } }, NOW).ok).toBe(false);
    });

    it('rejects null attribute values', () => {
        expect(validateLogEntry({ ...base, attributes: { x: null } }, NOW).ok).toBe(false);
    });

    it('rejects a non-object entry', () => {
        expect(validateLogEntry('nope', NOW).ok).toBe(false);
    });

    it('provides a rejection reason string', () => {
        const r = validateLogEntry({ ...base, level: 'boom' }, NOW);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(typeof r.reason).toBe('string');
    });
});