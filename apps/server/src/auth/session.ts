import { Effect, Schema } from 'effect'
import { Auth } from './service.ts'

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String,
}) {}

export function requireSession(headers: Headers) {
  return Effect.gen(function* () {
    const auth = yield* Auth

    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: () => new Error('Session lookup failed.'),
    }).pipe(Effect.orDie)

    if (!session) {
      return yield* Effect.fail(new Unauthorized({ message: 'Sign in to chat.' }))
    }

    return session
  })
}
