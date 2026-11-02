import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { ServerConfig } from './config.ts'
import { AgentLive } from './agent/agent.ts'
import { AuthLive } from './auth/service.ts'
import { ConversationStoreLive } from './conversations/store.ts'
import { WarehouseLive } from './data/warehouse.ts'
import { DatabaseLive } from './db/service.ts'
import { AuthRoutes } from './http/auth.ts'
import { Api } from './http/api.ts'
import { ChatHandlers } from './http/chat.ts'
import { ConversationHandlers } from './http/conversations.ts'
import { HealthHandlers } from './http/health.ts'

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Layer.mergeAll(HealthHandlers, ChatHandlers, ConversationHandlers)),
)

// Auth and conversations share one SQLite connection.
const AppServices = Layer.mergeAll(
  AuthLive,
  ConversationStoreLive,
  AgentLive.pipe(Layer.provide(WarehouseLive)),
).pipe(Layer.provide(DatabaseLive))

export const ServerLive = HttpRouter.serve(Layer.merge(ApiLive, AuthRoutes)).pipe(
  Layer.provide(AppServices),
  Layer.provide(NodeHttpServer.layerConfig(() => createServer(), ServerConfig)),
)
