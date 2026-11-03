import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from '@effect/vitest'
import type { UIMessage } from 'ai'
import { Effect, Exit, Fiber, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { ConversationConflict, ConversationNotFound } from './schema.ts'
import { makeConversationStore } from './store.ts'

const abandonedTurnGrace = '10 seconds'

type Store = Effect.Success<ReturnType<typeof makeConversationStore>>

function createDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY);')
  db.exec(`INSERT INTO "user" (id) VALUES ('alice'), ('bob')`)

  return db
}

const setup = Effect.gen(function* () {
  const db = createDatabase()
  const store = yield* makeConversationStore(db, abandonedTurnGrace)

  return { db, store }
})

const user = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

const assistant = (id: string, text: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
})

// Opens a turn in its own scope, standing in for the chat request that holds it.
const openTurn = (
  store: Store,
  conversationId: string,
  message: UIMessage,
  parentId: string | null,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()

    const turn = yield* Scope.provide(scope)(
      store.beginTurn('alice', conversationId, message, parentId),
    )

    return { turn, close: Scope.close(scope, Exit.void) }
  })

// The branch a reload shows: from the head back to the first message.
const headBranch = (store: Store, conversationId: string) =>
  Effect.gen(function* () {
    const { headId, messages } = yield* store.messages('alice', conversationId)
    const parents = new Map(messages.map((node) => [node.message.id, node.parentId]))
    const ids: string[] = []

    for (let id = headId; id !== null; id = parents.get(id) ?? null) ids.unshift(id)

    return ids
  })

const nodes = (store: Store, conversationId: string) =>
  Effect.map(store.messages('alice', conversationId), ({ messages }) => messages)

const completeTurn = (
  store: Store,
  conversationId: string,
  message: UIMessage,
  parentId: string | null,
  reply: UIMessage,
) =>
  Effect.gen(function* () {
    const { turn, close } = yield* openTurn(store, conversationId, message, parentId)
    yield* turn.finish([...turn.messages, reply])
    yield* close
  })

describe('ConversationStore', () => {
  it.effect('runs each migration once per database', () =>
    Effect.gen(function* () {
      const { db } = yield* setup
      yield* makeConversationStore(db, abandonedTurnGrace)

      const applied = db.prepare('SELECT name FROM migration').all()

      expect(applied.map((row) => row['name'])).toEqual([
        'conversations-001-create',
        'conversations-002-message-tree',
      ])
    }),
  )

  it.effect('turns linear conversations from before the tree into one branch', () =>
    Effect.gen(function* () {
      const db = createDatabase()

      // The schema and data as conversations-001 left them.
      db.exec(`
        CREATE TABLE migration (name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL);
        INSERT INTO migration VALUES ('conversations-001-create', '2026-11-01T00:00:00.000Z');
        CREATE TABLE conversation (
          id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
          title TEXT, status TEXT NOT NULL DEFAULT 'regular', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE TABLE conversation_message (
          conversationId TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          position INTEGER NOT NULL, message TEXT NOT NULL, PRIMARY KEY (conversationId, position)
        );
        INSERT INTO conversation VALUES ('c1', 'alice', 'Hi', 'regular', '2026-11-01', '2026-11-01');
      `)

      const insert = db.prepare('INSERT INTO conversation_message VALUES (?, ?, ?)')

      for (const [position, message] of [user('u1', 'Hi'), assistant('a1', 'Hello')].entries()) {
        insert.run('c1', position, JSON.stringify(message))
      }

      const store = yield* makeConversationStore(db, abandonedTurnGrace)

      expect(yield* headBranch(store, 'c1')).toEqual(['u1', 'a1'])

      yield* completeTurn(store, 'c1', user('u2', 'More'), 'a1', assistant('a2', 'Sure'))

      expect(yield* headBranch(store, 'c1')).toEqual(['u1', 'a1', 'u2', 'a2'])
    }),
  )

  it.effect('lists only the signed-in user’s conversations', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const first = yield* store.create('alice')
      const second = yield* store.create('alice')
      yield* store.create('bob')

      const listed = yield* store.list('alice')

      expect(listed.map((conversation) => conversation.id).sort()).toEqual([first, second].sort())
      expect(listed[0]).toMatchObject({ title: null, status: 'regular' })
    }),
  )

  it.effect('keeps users out of each other’s conversations', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')

      expect(yield* store.list('bob')).toEqual([])
      expect(yield* Effect.flip(store.get('bob', id))).toBeInstanceOf(ConversationNotFound)
      expect(yield* Effect.flip(store.messages('bob', id))).toBeInstanceOf(ConversationNotFound)
      expect(yield* Effect.flip(store.update('bob', id, { title: 'Stolen' }))).toBeInstanceOf(
        ConversationNotFound,
      )
      expect(yield* Effect.flip(store.remove('bob', id))).toBeInstanceOf(ConversationNotFound)

      expect(
        yield* Effect.flip(Effect.scoped(store.beginTurn('bob', id, user('u1', 'Hi'), null))),
      ).toBeInstanceOf(ConversationNotFound)

      expect((yield* store.get('alice', id)).id).toBe(id)
    }),
  )

  it.effect('removes a conversation with its messages', () =>
    Effect.gen(function* () {
      const { db, store } = yield* setup
      const id = yield* store.create('alice')
      yield* completeTurn(store, id, user('u1', 'Hi'), null, assistant('a1', 'Hello'))

      yield* store.remove('alice', id)

      expect(yield* Effect.flip(store.get('alice', id))).toBeInstanceOf(ConversationNotFound)
      expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_message').get()).toEqual({
        count: 0,
      })
    }),
  )

  it.effect('adds edits and regenerations as branches and keeps earlier ones', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')

      yield* completeTurn(store, id, user('u1', 'First question'), null, assistant('a1', 'One'))
      yield* completeTurn(store, id, user('u2', 'Second'), 'a1', assistant('a2', 'Two'))
      expect(yield* headBranch(store, id)).toEqual(['u1', 'a1', 'u2', 'a2'])

      // Regenerate: the stored user message is reused and gets a sibling response.
      const regenerated = yield* openTurn(store, id, user('u2', 'Second'), 'a1')

      expect(regenerated.turn.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])

      yield* regenerated.turn.finish([...regenerated.turn.messages, assistant('a2b', 'Again')])
      yield* regenerated.close

      expect(yield* headBranch(store, id)).toEqual(['u1', 'a1', 'u2', 'a2b'])
      expect(yield* nodes(store, id)).toHaveLength(5)

      // Edit the first message: a new root branch; the old branch stays stored.
      yield* completeTurn(store, id, user('u1b', 'Edited'), null, assistant('a1b', 'New'))
      expect(yield* headBranch(store, id)).toEqual(['u1b', 'a1b'])

      const parents = new Map(
        (yield* nodes(store, id)).map((node) => [node.message.id, node.parentId]),
      )

      expect(parents.size).toBe(7)
      expect(parents.get('a2')).toBe('u2')
      expect(parents.get('a2b')).toBe('u2')
      expect(parents.get('u1b')).toBeNull()
      expect((yield* store.get('alice', id)).title).toBe('First question')
    }),
  )

  it.effect('treats a parent that is not stored as a conflict', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')

      const missing = Effect.scoped(store.beginTurn('alice', id, user('u1', 'Hi'), 'missing'))
      expect(yield* Effect.flip(missing)).toBeInstanceOf(ConversationConflict)

      // The failed turn does not hold up the next one.
      yield* completeTurn(store, id, user('u1', 'Hi'), null, assistant('a1', 'Hello'))
      expect(yield* nodes(store, id)).toHaveLength(2)

      // A stored message id cannot move to another parent.
      const moved = Effect.scoped(store.beginTurn('alice', id, user('u1', 'Hi'), 'a1'))
      expect(yield* Effect.flip(moved)).toBeInstanceOf(ConversationConflict)
    }),
  )

  it.effect('titles a conversation from its first user message and keeps a rename', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')
      const long = 'word '.repeat(30)

      yield* completeTurn(store, id, user('u1', long), null, assistant('a1', 'Hello'))
      const { title } = yield* store.get('alice', id)

      expect(title).toHaveLength(60)
      expect(title?.endsWith('…')).toBe(true)

      yield* store.update('alice', id, { title: 'Renamed', status: 'archived' })
      yield* completeTurn(store, id, user('u2', 'More'), 'a1', assistant('a2', 'Sure'))

      expect(yield* store.get('alice', id)).toMatchObject({ title: 'Renamed', status: 'archived' })
    }),
  )

  it.effect('keeps a short title whole and collapses its whitespace', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')

      yield* completeTurn(store, id, user('u1', '  Hello \n  there  '), null, assistant('a1', 'Hi'))

      expect((yield* store.get('alice', id)).title).toBe('Hello there')
    }),
  )

  it.effect.each([
    {
      case: 'keeps a title of exactly the limit whole',
      text: 'x'.repeat(60),
      title: 'x'.repeat(60),
    },
    {
      case: 'trims the space before the ellipsis when cutting',
      text: `${'x'.repeat(58)} ${'y'.repeat(10)}`,
      title: `${'x'.repeat(58)}…`,
    },
    { case: 'leaves a blank first message untitled', text: '   ', title: null },
  ])('$case', ({ text, title }) =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')

      yield* completeTurn(store, id, user('u1', text), null, assistant('a1', 'Hi'))

      expect((yield* store.get('alice', id)).title).toBe(title)
    }),
  )

  it.effect('makes a turn wait for the previous response to be saved', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')
      const first = yield* openTurn(store, id, user('u1', 'Hi'), null)

      const second = yield* Effect.forkChild(openTurn(store, id, user('u2', 'Next'), 'a1'))
      yield* Effect.yieldNow
      expect(second.pollUnsafe()).toBeUndefined()

      yield* first.turn.finish([...first.turn.messages, assistant('a1', 'Hello')])
      yield* first.close

      const { turn, close } = yield* Fiber.join(second)
      expect(turn.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])

      yield* turn.release
      yield* close
    }),
  )

  it.effect('stops waiting for an abandoned turn after the grace period', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')
      const abandoned = yield* openTurn(store, id, user('u1', 'Hi'), null)
      yield* abandoned.close

      const next = yield* Effect.forkChild(
        completeTurn(store, id, user('u1b', 'Again'), null, assistant('a1b', 'Hello')),
      )

      yield* TestClock.adjust(abandonedTurnGrace)
      yield* Fiber.join(next)

      // The abandoned response finishes after the newer turn.
      yield* abandoned.turn.finish([...abandoned.turn.messages, assistant('a1', 'Late')])

      expect(yield* headBranch(store, id)).toEqual(['u1b', 'a1b'])

      const late = (yield* nodes(store, id)).find((node) => node.message.id === 'a1')
      expect(late?.parentId).toBe('u1')
    }),
  )

  it.effect('does not store an empty response', () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const id = yield* store.create('alice')
      const { turn, close } = yield* openTurn(store, id, user('u1', 'Hi'), null)

      yield* turn.finish([...turn.messages, { id: 'a1', role: 'assistant', parts: [] }])
      yield* close

      expect(yield* headBranch(store, id)).toEqual(['u1'])
    }),
  )
})
