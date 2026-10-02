import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { ServerConfig } from './config.ts'
import { AuthLive } from './auth/service.ts'
import { AuthRoutes } from './http/auth.ts'
import { Api } from './http/api.ts'
import { ChatHandlers } from './http/chat.ts'
import { HealthHandlers } from './http/health.ts'

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Layer.mergeAll(HealthHandlers, ChatHandlers)),
)

// Supply concrete application services here as they are implemented.
export const ServerLive = HttpRouter.serve(Layer.merge(ApiLive, AuthRoutes)).pipe(
  Layer.provide(AuthLive),
  Layer.provide(NodeHttpServer.layerConfig(() => createServer(), ServerConfig)),
)
