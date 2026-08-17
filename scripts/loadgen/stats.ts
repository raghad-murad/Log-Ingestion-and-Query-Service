// Latency statistics: percentiles from an array of millisecond samples.

export interface LatencyStats {
    count: number;
    min: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    mean: number;
}

export function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
    return sortedAsc[Math.min(Math.max(idx, 0), sortedAsc.length - 1)];
}

export function computeStats(samplesMs: number[]): LatencyStats {
    if (samplesMs.length === 0) {
        return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
    }
    const sorted = [...samplesMs].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
        count: sorted.length,
        min: sorted[0],
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1],
        mean: sum / sorted.length,
    };
}

export function formatStats(label: string, s: LatencyStats): string {
    const r = (n: number) => n.toFixed(1);
    return `${label}: n=${s.count} min=${r(s.min)} p50=${r(s.p50)} p95=${r(s.p95)} p99=${r(s.p99)} max=${r(s.max)} mean=${r(s.mean)} (ms)`;
}