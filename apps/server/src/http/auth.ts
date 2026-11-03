import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { Auth } from '../auth/service.ts'

export const AuthRoutes = HttpRouter.add('*', '/api/auth/*', (request) =>
  Effect.gen(function* () {
    const auth = yield* Auth
    const webRequest = yield* HttpServerRequest.toWeb(request)

    const response = yield* Effect.promise(() => auth.handler(webRequest))

    return HttpServerResponse.fromWeb(response)
  }).pipe(Effect.orDie),
)
