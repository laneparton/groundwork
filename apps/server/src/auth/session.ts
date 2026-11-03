import { Effect, Schema } from 'effect'
import { Auth } from './service.ts'

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String,
}) {}

export function requireSession(headers: Headers) {
  return Effect.gen(function* () {
    const auth = yield* Auth

    // A failed lookup is a server fault, not a signed-out user.
    const session = yield* Effect.promise(() => auth.api.getSession({ headers }))

    if (!session) {
      return yield* new Unauthorized({ message: 'Sign in to chat.' })
    }

    return session
  })
}
