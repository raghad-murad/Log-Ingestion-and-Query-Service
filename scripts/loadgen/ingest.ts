// Closed-loop ingestion load: a fixed pool of concurrent workers each POST a
// batch, await the response, then send the next — for a fixed duration.
// Throughput = accepted logs / elapsed seconds. Controlled by (workers, batchSize).

import { generateBatch, makeRng, type GenerateOptions } from './generate';
import { computeStats, type LatencyStats } from './stats';

export interface IngestConfig {
    baseUrl: string;
    workers: number;
    batchSize: number;
    durationSec: number;
    genOptions?: GenerateOptions;
    seed?: number;
}

export interface IngestReport {
    workers: number;
    batchSize: number;
    durationSec: number;
    elapsedSec: number;
    requests: number;
    acceptedLogs: number;
    rejectedLogs: number;
    errors: number;
    throughputPerSec: number;
    latency: LatencyStats;
}

export async function runIngest(config: IngestConfig): Promise<IngestReport> {
    const { baseUrl, workers, batchSize, durationSec } = config;
    const url = `${baseUrl}/logs`;
    const deadline = Date.now() + durationSec * 1000;

    let requests = 0;
    let accepted = 0;
    let rejected = 0;
    let errors = 0;
    const latencies: number[] = [];

    async function worker(workerId: number): Promise<void> {
        // Each worker gets its own RNG stream for varied but reproducible data.
        const rnd = makeRng((config.seed ?? 1) * 1000 + workerId);
        while (Date.now() < deadline) {
            const batch = generateBatch(rnd, batchSize, config.genOptions);
            const body = JSON.stringify({ logs: batch });
            const start = performance.now();
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body,
                });
                const elapsed = performance.now() - start;
                latencies.push(elapsed);
                requests++;
                if (res.ok) {
                    const json = (await res.json()) as { accepted: number; rejected: unknown[] };
                    accepted += json.accepted;
                    rejected += json.rejected?.length ?? 0;
                } else {
                    errors++;
                    await res.text(); // drain body
                }
            } catch {
                errors++;
            }
        }
    }

    const startTime = performance.now();
    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
    const elapsedSec = (performance.now() - startTime) / 1000;

    return {
        workers,
        batchSize,
        durationSec,
        elapsedSec,
        requests,
        acceptedLogs: accepted,
        rejectedLogs: rejected,
        errors,
        throughputPerSec: accepted / elapsedSec,
        latency: computeStats(latencies),
    };
}