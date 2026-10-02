import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'

// Liveness only. Add dependency readiness separately when dependencies exist.
export const HealthHandlers = HttpApiBuilder.group(Api, 'health', (handlers) =>
  handlers.handle('health', () => Effect.succeed({ status: 'ok' as const })),
)
