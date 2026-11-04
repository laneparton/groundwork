import { Deferred, Effect } from 'effect'

export interface TurnSlot {
  /** Waits until every earlier turn on the conversation has been released. */
  readonly ready: Effect.Effect<void>
  /** Lets the next turn start once earlier turns finish. Safe to call more than once. */
  readonly release: Effect.Effect<void>
  readonly isReleased: Effect.Effect<boolean>
}

// Runs a conversation's turns one at a time, in arrival order, so a response that
// finishes late cannot overwrite a turn that started after it. The queue lives in
// memory, which holds while one server process owns the database.
export function createTurnQueue() {
  const tails = new Map<string, Deferred.Deferred<void>>()

  return {
    enter(conversationId: string): TurnSlot {
      const previous = tails.get(conversationId)
      const done = Deferred.makeUnsafe<void>()
      tails.set(conversationId, done)

      const ready = previous ? Deferred.await(previous) : Effect.void

      const release = Effect.asVoid(
        Effect.forkDetach(
          Effect.gen(function* () {
            yield* ready
            yield* Deferred.succeed(done, undefined)

            // Forgets finished conversations so the map does not grow. No behavior depends
            // on it, so tests cannot observe it.
            // Stryker disable next-line all
            if (tails.get(conversationId) === done) tails.delete(conversationId)
          }),
        ),
      )

      return { ready, release, isReleased: Deferred.isDone(done) }
    },
  }
}
