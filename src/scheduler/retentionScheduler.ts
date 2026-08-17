import type { RetentionService } from '../services/retentionService';

// Decides WHEN retention runs — timing only, no policy. Runs one cycle immediately
// (after the service is ready) and then on a fixed interval. A failed cycle is
// logged and the next cycle proceeds; maintenance is off the hot path, so its
// failure must never take the service down (contrast: startup failure => not ready).
export interface RetentionScheduler {
    start(): void;
    stop(): void;
}

export function createRetentionScheduler(
    retentionService: RetentionService,
    intervalMs: number,
    log: { info: (msg: string) => void; error: (obj: unknown, msg?: string) => void },
): RetentionScheduler {
    let timer: NodeJS.Timeout | undefined;

    const runSafely = async (): Promise<void> => {
        try {
            await retentionService.runOnce();
        } catch (err) {
            log.error(err, 'retention maintenance cycle failed; will retry next interval');
        }
    };

    return {
        start(): void {
            // First cycle immediately (handles already-expired data at startup).
            void runSafely();
            // Then every interval. unref() so the timer never keeps the process alive.
            timer = setInterval(() => void runSafely(), intervalMs);
            timer.unref();
            log.info(`retention scheduler started (interval ${intervalMs}ms)`);
        },
        
        stop(): void {
            if (timer) clearInterval(timer);
        },
    };
}