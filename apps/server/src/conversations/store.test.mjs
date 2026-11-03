import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Effect, Exit, Scope } from 'effect'
import { makeConversationStore } from './store.ts'

const abandonedTurnGrace = '20 millis'

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY);')
  db.exec(`INSERT INTO "user" (id) VALUES ('alice'), ('bob')`)

  const store = Effect.runSync(makeConversationStore(db, abandonedTurnGrace))

  return { db, store }
}

const run = (effect) => Effect.runPromise(effect)
const failure = async (effect) => (await run(Effect.flip(effect)))._tag

const user = (id, text) => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const assistant = (id, text) => ({ id, role: 'assistant', parts: [{ type: 'text', text }] })

// Opens a turn in its own scope, standing in for the chat request that holds it.
async function openTurn(store, conversationId, message, parentId) {
  const scope = Effect.runSync(Scope.make())

  const turn = await run(
    Scope.provide(scope)(store.beginTurn('alice', conversationId, message, parentId)),
  )

  return { turn, close: () => run(Scope.close(scope, Exit.void)) }
}

async function completeTurn(store, conversationId, message, parentId, reply) {
  const { turn, close } = await openTurn(store, conversationId, message, parentId)
  await run(turn.finish([...turn.messages, reply]))
  await close()
}

test('Migrations run once per database', () => {
  const { db } = setup()
  Effect.runSync(makeConversationStore(db, abandonedTurnGrace))

  const applied = db.prepare('SELECT name FROM migration').all()
  assert.deepEqual(
    applied.map((row) => row.name),
    ['conversations-001-create'],
  )
})

test('Users only reach their own conversations', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))

  assert.deepEqual(await run(store.list('bob')), [])
  assert.equal(await failure(store.get('bob', id)), 'ConversationNotFound')
  assert.equal(await failure(store.messages('bob', id)), 'ConversationNotFound')
  assert.equal(await failure(store.update('bob', id, { title: 'Stolen' })), 'ConversationNotFound')
  assert.equal(await failure(store.remove('bob', id)), 'ConversationNotFound')

  const turn = Effect.scoped(store.beginTurn('bob', id, user('u1', 'Hi'), null))
  assert.equal(await failure(turn), 'ConversationNotFound')

  assert.equal((await run(store.get('alice', id))).id, id)
})

test('A turn replaces everything stored after its parent', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))

  await completeTurn(store, id, user('u1', 'First question'), null, assistant('a1', 'One'))
  await completeTurn(store, id, user('u2', 'Second'), 'a1', assistant('a2', 'Two'))

  const ids = async () => (await run(store.messages('alice', id))).map((message) => message.id)
  assert.deepEqual(await ids(), ['u1', 'a1', 'u2', 'a2'])

  // Regenerate: the same user message after the same parent gets a new response.
  await completeTurn(store, id, user('u2', 'Second'), 'a1', assistant('a2b', 'Two again'))
  assert.deepEqual(await ids(), ['u1', 'a1', 'u2', 'a2b'])

  // Edit the first message: everything after it is dropped.
  await completeTurn(store, id, user('u1b', 'Edited'), null, assistant('a1b', 'New'))
  assert.deepEqual(await ids(), ['u1b', 'a1b'])

  assert.equal((await run(store.get('alice', id))).title, 'First question')
})

test('A parent that is not stored is a conflict', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))

  const turn = Effect.scoped(store.beginTurn('alice', id, user('u1', 'Hi'), 'missing'))
  assert.equal(await failure(turn), 'ConversationConflict')

  // The failed turn does not hold up the next one.
  await completeTurn(store, id, user('u1', 'Hi'), null, assistant('a1', 'Hello'))
  assert.equal((await run(store.messages('alice', id))).length, 2)
})

test('Titles come from the first user message and survive a rename', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))
  const long = 'word '.repeat(30)

  await completeTurn(store, id, user('u1', long), null, assistant('a1', 'Hello'))
  const { title } = await run(store.get('alice', id))
  assert.equal(title.length, 60)
  assert.ok(title.endsWith('…'))

  await run(store.update('alice', id, { title: 'Renamed', status: 'archived' }))
  await completeTurn(store, id, user('u2', 'More'), 'a1', assistant('a2', 'Sure'))

  const renamed = await run(store.get('alice', id))
  assert.equal(renamed.title, 'Renamed')
  assert.equal(renamed.status, 'archived')
})

test('A turn waits for the previous response to be saved', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))
  const first = await openTurn(store, id, user('u1', 'Hi'), null)

  let started = false

  const second = openTurn(store, id, user('u2', 'Next'), 'a1').then((opened) => {
    started = true

    return opened
  })

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(started, false, 'The second turn waits while the first is open')

  await run(first.turn.finish([...first.turn.messages, assistant('a1', 'Hello')]))
  await first.close()

  const { turn, close } = await second
  assert.deepEqual(
    turn.messages.map((message) => message.id),
    ['u1', 'a1', 'u2'],
  )

  await run(turn.release)
  await close()
})

test('An abandoned turn stops blocking after the grace period and cannot overwrite later turns', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))
  const abandoned = await openTurn(store, id, user('u1', 'Hi'), null)
  await abandoned.close()

  await completeTurn(store, id, user('u1b', 'Again'), null, assistant('a1b', 'Hello'))

  // The abandoned response finishes late; saving it would erase the newer turn.
  await run(abandoned.turn.finish([...abandoned.turn.messages, assistant('a1', 'Late')]))

  const stored = await run(store.messages('alice', id))
  assert.deepEqual(
    stored.map((message) => message.id),
    ['u1b', 'a1b'],
  )
})
