// Load-test CLI. Runs staged workloads and prints a report for the README.
//
// Usage:
//   npx tsx scripts/loadgen/run.ts <stage> [--url=http://localhost:8080]
//
// Stages:
//   smoke        one small batch, sanity
//   ingest       staged ingest ramp (1k->15k target) to find best (workers,batch)
//   concurrent   sustained ingest + concurrent aggregate (p95 under load)
//   seed         fill the DB with ~1M historical rows (for query tests)

import { runIngest } from './ingest';
import { runAggregateProbe } from './aggregate';
import { formatStats } from './stats';

const args = process.argv.slice(2);
const stage = args[0] ?? 'smoke';
const urlArg = args.find((a) => a.startsWith('--url='));
const baseUrl = urlArg ? urlArg.slice('--url='.length) : 'http://localhost:8080';

async function waitHealthy(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        try {
        const res = await fetch(`${baseUrl}/health`);
        if (res.ok) return;
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`service at ${baseUrl} never became healthy`);
}

async function smoke(): Promise<void> {
    console.log('# smoke test');
    const r = await runIngest({ baseUrl, workers: 1, batchSize: 10, durationSec: 2 });
    console.log(`accepted=${r.acceptedLogs} errors=${r.errors} throughput=${r.throughputPerSec.toFixed(0)}/s`);
    console.log(formatStats('ingest latency', r.latency));
}

// Ramp: try several (workers x batchSize) combos, each for a short window.
async function ingestRamp(): Promise<void> {
    console.log('# ingest ramp — finding best (workers, batchSize)\n');
    const combos = [
        { workers: 2, batchSize: 100 },
        { workers: 4, batchSize: 250 },
        { workers: 4, batchSize: 500 },
        { workers: 8, batchSize: 500 },
        { workers: 8, batchSize: 1000 },
        { workers: 16, batchSize: 1000 },
        { workers: 16, batchSize: 2000 },
    ];
    console.log('workers  batch   throughput/s   p95(ms)   errors');
    for (const c of combos) {
        const r = await runIngest({ baseUrl, ...c, durationSec: 8 });
        console.log(
        `${String(c.workers).padEnd(7)}  ${String(c.batchSize).padEnd(5)}   ` +
        `${r.throughputPerSec.toFixed(0).padEnd(12)}   ${r.latency.p95.toFixed(0).padEnd(7)}   ${r.errors}`,
        );
    }
}

async function concurrent(): Promise<void> {
    console.log('# sustained ingest + concurrent aggregate (p95 under load)\n');
    const [ingestReport, aggReport] = await Promise.all([
        runIngest({ baseUrl, workers: 8, batchSize: 1000, durationSec: 20 }),
        runAggregateProbe({ baseUrl, requestsPerSec: 1, durationSec: 20, windowHours: 1, bucket: '1m', groupBy: 'service' }),
    ]);
    console.log(`ingest throughput: ${ingestReport.throughputPerSec.toFixed(0)}/s  errors=${ingestReport.errors}`);
    console.log(formatStats('aggregate latency (under load)', aggReport.latency));
    console.log(`aggregate p95 < 1000ms? ${aggReport.latency.p95 < 1000 ? 'YES' : 'NO'}`);
}

async function seed(): Promise<void> {
    const target = 1_000_000;
    console.log(`# seeding ~${target} historical rows (spread over 30 days)`);
    let total = 0;
    const start = performance.now();
    while (total < target) {
        const r = await runIngest({
            baseUrl, workers: 8, batchSize: 2000, durationSec: 3,
            genOptions: { historicalDays: 30 },
        });
        total += r.acceptedLogs;
        process.stdout.write(`\r  inserted ${total.toLocaleString()} rows...`);
    }
    const elapsed = (performance.now() - start) / 1000;
    console.log(`\n  done: ${total.toLocaleString()} rows in ${elapsed.toFixed(0)}s`);
}

async function main(): Promise<void> {
    await waitHealthy();
    switch (stage) {
        case 'smoke': return smoke();
        case 'ingest': return ingestRamp();
        case 'concurrent': return concurrent();
        case 'seed': return seed();
        default:
            console.error(`unknown stage: ${stage} (use smoke | ingest | concurrent | seed)`);
            process.exit(1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });