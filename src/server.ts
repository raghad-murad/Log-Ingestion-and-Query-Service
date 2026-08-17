import Fastify, { type FastifyInstance } from 'fastify';
import type { Readiness } from './health/readiness';
import type { LogService } from './services/logService';
import { registerHealthRoute } from './routes/health';
import { registerIngestRoute } from './routes/ingest';

export interface ServerDeps {
    readiness: Readiness;
    logService: LogService;
}

// Builds the Fastify app WITHOUT starting to listen, so integration tests can
// exercise it via app.inject() without binding a real port.
export function buildServer(deps: ServerDeps): FastifyInstance {
    const app = Fastify({
        logger: true,
        // Ingestion batches are large; the 1 MB default would reject them.
        // 16 MB is a generous cap (also a natural admission limit, see DESIGN.md §1b).
        bodyLimit: 16 * 1024 * 1024,
    });

    registerHealthRoute(app, deps.readiness);
    registerIngestRoute(app, deps.logService);

    return app;
}