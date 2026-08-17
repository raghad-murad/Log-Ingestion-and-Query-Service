// Encodes/decodes the keyset pagination cursor (see DESIGN.md §6, §7).
// The cursor is the (timestamp, id) of the last row of a page. It is serialized
// as an opaque base64url token at the API boundary; the load generator passes it
// back unchanged. Malformed cursors are rejected (the route maps that to 400).

import type { Cursor } from '../domain/types';

export class InvalidCursorError extends Error {
    constructor(message = 'invalid cursor') {
        super(message);
        this.name = 'InvalidCursorError';
    }
}

export function encodeCursor(cursor: Cursor): string {
    const json = JSON.stringify({ t: cursor.timestamp, i: cursor.id });
    return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(token: string): Cursor {
    let parsed: unknown;
    try {
        const json = Buffer.from(token, 'base64url').toString('utf8');
        parsed = JSON.parse(json);
    } catch {
        throw new InvalidCursorError();
    }

    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { t?: unknown }).t !== 'string' ||
        typeof (parsed as { i?: unknown }).i !== 'string'
    ) {
        throw new InvalidCursorError();
    }

    const { t, i } = parsed as { t: string; i: string };
    // Sanity: the timestamp must be a real date and the id must be a digit string.
    if (Number.isNaN(Date.parse(t)) || !/^\d+$/.test(i)) {
        throw new InvalidCursorError();
    }

    return { timestamp: t, id: i };
}