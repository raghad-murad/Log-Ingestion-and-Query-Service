import type { FastifyInstance } from 'fastify';
import type { LogService } from '../services/logService';
import { validateQueryParams } from '../validation/queryParams';

// GET /logs — filter, sort (timestamp DESC, id DESC), keyset-paginate.
export function registerQueryRoute(app: FastifyInstance, logService: LogService): void {
    app.get('/logs', async (request, reply) => {
        const validation = validateQueryParams(request.query as Record<string, unknown>);
        if (!validation.ok) {
            return reply.code(400).send({ error: validation.error });
        }
        const result = await logService.query(validation.filter);
        return reply.code(200).send(result);
    });
}