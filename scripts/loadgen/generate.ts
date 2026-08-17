// Synthetic log generator (see DESIGN.md load-test methodology).
// Produces realistic, varied logs. Timestamps can be "now" (for ingest-rate
// tests) or spread across a historical window (to fill partitions / test pruning).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GeneratedLog {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
}

const SERVICES = ['checkout', 'auth', 'orders', 'payments', 'search', 'inventory'];
const LEVELS: LogLevel[] = ['debug', 'info', 'info', 'info', 'warn', 'error']; // info-heavy, realistic
const REGIONS = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-south'];
const MESSAGES = [
    'request completed', 'payment declined', 'cache miss', 'user login ok',
    'connection timeout', 'order created', 'inventory updated', 'rate limit hit',
];

function pick<T>(arr: T[], rnd: () => number): T {
    return arr[Math.floor(rnd() * arr.length)];
}

// Simple seedable RNG (mulberry32) so runs are reproducible.
export function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface GenerateOptions {
  // If set, timestamps spread uniformly across [now - historicalDays, now]; else "now".
  historicalDays?: number;
  // A pool of user_ids to draw from; smaller pool => some values common, some rare.
  userIdPool?: number;
}

export function generateLog(rnd: () => number, opts: GenerateOptions = {}): GeneratedLog {
    const now = Date.now();
    const ts =
        opts.historicalDays !== undefined
        ? new Date(now - Math.floor(rnd() * opts.historicalDays * 86_400_000)).toISOString()
        : new Date(now).toISOString();

    const userPool = opts.userIdPool ?? 10_000;

    return {
        timestamp: ts,
        level: pick(LEVELS, rnd),
        service: pick(SERVICES, rnd),
        message: pick(MESSAGES, rnd),
        attributes: {
        user_id: String(Math.floor(rnd() * userPool)),
        region: pick(REGIONS, rnd),
        request_id: `req-${Math.floor(rnd() * 1_000_000)}`,
        retries: Math.floor(rnd() * 4),
        },
    };
}

// Build a batch of N logs.
export function generateBatch(rnd: () => number, size: number, opts?: GenerateOptions): GeneratedLog[] {
    const batch: GeneratedLog[] = new Array(size);
    for (let i = 0; i < size; i++) batch[i] = generateLog(rnd, opts);
    return batch;
}