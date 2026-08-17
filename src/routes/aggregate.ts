import type { FastifyInstance } from 'fastify';
import type { LogService } from '../services/logService';
import { validateAggregateParams } from '../validation/aggregateParams';

// GET /logs/aggregate — time-bucketed counts, ordered by bucket start ASC.
export function registerAggregateRoute(app: FastifyInstance, logService: LogService): void {
    app.get('/logs/aggregate', async (request, reply) => {
        const validation = validateAggregateParams(request.query as Record<string, unknown>);
        if (!validation.ok) {
            return reply.code(400).send({ error: validation.error });
        }
        const result = await logService.aggregate(validation.query);
            return reply.code(200).send(result);
    });
}