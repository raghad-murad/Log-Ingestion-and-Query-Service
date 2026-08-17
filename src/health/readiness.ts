export type ServiceState = 'starting' | 'ready';

export interface Readiness {
    getState(): ServiceState;
    isReady(): boolean;
    markReady(): void;
}

/**
    Tracks whether the service has finished its startup sequence
    /health reports 503 while "starting" and 200 once "ready"

    Uses a factory function to isolate state per instance, ensuring parallel integration tests don't leak state between servers
*/
export function createReadiness(): Readiness {
    let state: ServiceState = 'starting';
    return {
        getState: () => state,
        isReady: () => state === 'ready',
        markReady: () => {
            state = 'ready';
        },
    };
}
