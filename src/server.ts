import Fastify, { type FastifyInstance } from 'fastify';
import type { Readiness } from './health/readiness';
import { registerHealthRoute } from './routes/health';

// Interface for the dependencies needed to construct the server
export interface ServerDeps {
    readiness: Readiness;
}

// Builds the Fastify application instance.
// Separated from listening logic to allow integration testing via `app.inject()` without binding to a port.
export function buildServer(deps: ServerDeps): FastifyInstance {

    const app = Fastify({ logger: true });

    registerHealthRoute(app, deps.readiness);

    return app;
}
