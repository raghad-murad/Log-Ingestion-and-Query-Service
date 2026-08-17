import type { Pool } from 'pg';
import type { Config } from '../config';
import { ensurePartitions, dropExpiredPartitions } from '../repository/partitionManager';

// Decides WHAT retention maintenance does; delegates the DDL to PartitionManager
// (see DESIGN.md §5, §8). One cycle:
//   1. ensure future/in-window partitions exist, then
//   2. drop partitions fully outside the retention window.
// Ensure runs before drop so we never momentarily lack a needed partition.
export interface RetentionService {
  runOnce(): Promise<{ ensured: number; dropped: string[] }>;
}

export function createRetentionService(
    pool: Pool,
    config: Config,
    log: { info: (msg: string) => void },
): RetentionService {
    return {
        async runOnce() {
            const ensured = (await ensurePartitions(pool, config)).length;
            const dropped = await dropExpiredPartitions(pool, config);
            log.info(
                `retention cycle: ensured ${ensured} partitions, dropped ${dropped.length}` +
                (dropped.length ? ` (${dropped.join(', ')})` : ''),
            );
            return { ensured, dropped };
        },
    };
}