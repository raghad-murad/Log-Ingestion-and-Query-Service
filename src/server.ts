import Fastify, { type FastifyInstance } from 'fastify';
import type { Readiness } from './health/readiness';
import type { LogService } from './services/logService';
import { registerHealthRoute } from './routes/health';
import { registerIngestRoute } from './routes/ingest';
import { registerQueryRoute } from './routes/query';
import { registerAggregateRoute } from './routes/aggregate';

export interface ServerDeps {
    readiness: Readiness;
    logService: LogService;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
    const app = Fastify({
        logger: true,
        bodyLimit: 16 * 1024 * 1024,
    });

    registerHealthRoute(app, deps.readiness);
    registerIngestRoute(app, deps.logService);
    // Register /logs/aggregate BEFORE /logs is irrelevant in Fastify (no prefix clash),
    // but keeping related routes together is clearer.
    registerAggregateRoute(app, deps.logService);
    registerQueryRoute(app, deps.logService);

    return app;
}