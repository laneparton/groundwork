import { NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { ServerLive } from './layers.ts'

NodeRuntime.runMain(Layer.launch(ServerLive))
