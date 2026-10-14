import { Effect } from 'effect'
import { Unauthorized } from '../http/errors.ts'
import { Auth } from './service.ts'

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
