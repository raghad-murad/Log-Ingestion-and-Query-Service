import type { FastifyInstance } from 'fastify';
import type { LogService } from '../services/logService';

// POST /logs — always a batch: { "logs": [ ... ] }.
// 200 when >= 1 entry accepted; 400 on malformed JSON, wrong top-level shape,
// or when all entries are rejected.
export function registerIngestRoute(app: FastifyInstance, logService: LogService): void {
    app.post('/logs', async (request, reply) => {
        const body = request.body;

        // Top-level shape: must be an object with a `logs` array.
        if (typeof body !== 'object' || body === null || !Array.isArray((body as { logs?: unknown }).logs)) {
            return reply.code(400).send({ error: "request body must be an object with a 'logs' array" });
        }

        const rawLogs = (body as { logs: unknown[] }).logs;
        const result = await logService.ingest(rawLogs);

        // All rejected (or empty batch) -> 400. At least one accepted -> 200.
        if (result.accepted === 0) {
            return reply.code(400).send({ accepted: 0, rejected: result.rejected });
        }
        
        return reply.code(200).send(result);
    });
}