// Fires aggregation queries at a target rate and measures latency percentiles.
// Used standalone and (concurrently) during ingestion to verify p95 < 1s under load.

import { computeStats, type LatencyStats } from './stats';

export interface AggregateProbeConfig {
    baseUrl: string;
    requestsPerSec: number;   // e.g. 1 (contract minimum)
    durationSec: number;
    windowHours: number;      // aggregation range width
    bucket: '1m' | '5m' | '1h' | '1d';
    groupBy?: 'service' | 'level';
}

export interface AggregateReport {
    requests: number;
    errors: number;
    latency: LatencyStats;
}

export async function runAggregateProbe(config: AggregateProbeConfig): Promise<AggregateReport> {
    const { baseUrl, requestsPerSec, durationSec, windowHours, bucket, groupBy } = config;
    const deadline = Date.now() + durationSec * 1000;
    const intervalMs = 1000 / requestsPerSec;

    const latencies: number[] = [];
    let requests = 0;
    let errors = 0;

    while (Date.now() < deadline) {
        const until = new Date();
        const since = new Date(until.getTime() - windowHours * 3_600_000);
        const params = new URLSearchParams({
            since: since.toISOString(),
            until: until.toISOString(),
            bucket,
        });
        if (groupBy) params.set('group_by', groupBy);

        const start = performance.now();
        try {
            const res = await fetch(`${baseUrl}/logs/aggregate?${params.toString()}`);
            const elapsed = performance.now() - start;
            latencies.push(elapsed);
            requests++;
            if (!res.ok) errors++;
            await res.text();
        } catch {
            errors++;
        }

        const wait = intervalMs - (performance.now() - start);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }

    return { requests, errors, latency: computeStats(latencies) };
}