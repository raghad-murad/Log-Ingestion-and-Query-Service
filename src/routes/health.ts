import type { FastifyInstance } from 'fastify';
import type { Readiness } from '../health/readiness';

// GET /health — always public. Returns 503 during startup, 200 once ready
// The load generator polls this before sending traffic
export function registerHealthRoute(app: FastifyInstance, readiness: Readiness): void {
    app.get('/health', async (_request, reply) => {
        if (readiness.isReady()) {
           return reply.code(200).send({ status: 'ready' });
        }
        return reply.code(503).send({ status: readiness.getState() });
    });
}
