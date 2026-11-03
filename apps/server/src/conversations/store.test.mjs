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

// The branch a reload shows: from the head back to the first message.
async function headBranch(store, conversationId) {
  const { headId, messages } = await run(store.messages('alice', conversationId))
  const byId = new Map(messages.map((node) => [node.message.id, node]))
  const ids = []

  for (let id = headId; id !== null; id = byId.get(id).parentId) ids.unshift(id)

  return ids
}

async function nodeCount(store, conversationId) {
  return (await run(store.messages('alice', conversationId))).messages.length
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
    ['conversations-001-create', 'conversations-002-message-tree'],
  )
})

test('Linear conversations from before the tree become one branch', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY);')
  db.exec(`INSERT INTO "user" (id) VALUES ('alice')`)

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

  const store = Effect.runSync(makeConversationStore(db, abandonedTurnGrace))

  assert.deepEqual(await headBranch(store, 'c1'), ['u1', 'a1'])
  await completeTurn(store, 'c1', user('u2', 'More'), 'a1', assistant('a2', 'Sure'))
  assert.deepEqual(await headBranch(store, 'c1'), ['u1', 'a1', 'u2', 'a2'])
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

test('Edits and regenerations add branches and keep earlier ones', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))

  await completeTurn(store, id, user('u1', 'First question'), null, assistant('a1', 'One'))
  await completeTurn(store, id, user('u2', 'Second'), 'a1', assistant('a2', 'Two'))
  assert.deepEqual(await headBranch(store, id), ['u1', 'a1', 'u2', 'a2'])

  // Regenerate: the stored user message is reused and gets a sibling response.
  const regenerated = await openTurn(store, id, user('u2', 'Second'), 'a1')
  assert.deepEqual(
    regenerated.turn.messages.map((message) => message.id),
    ['u1', 'a1', 'u2'],
    'The model sees only the branch being answered',
  )
  await run(regenerated.turn.finish([...regenerated.turn.messages, assistant('a2b', 'Again')]))
  await regenerated.close()

  assert.deepEqual(await headBranch(store, id), ['u1', 'a1', 'u2', 'a2b'])
  assert.equal(await nodeCount(store, id), 5, 'The first response is kept as a sibling')

  // Edit the first message: a new root branch; the old branch stays stored.
  await completeTurn(store, id, user('u1b', 'Edited'), null, assistant('a1b', 'New'))
  assert.deepEqual(await headBranch(store, id), ['u1b', 'a1b'])
  assert.equal(await nodeCount(store, id), 7)

  const { messages } = await run(store.messages('alice', id))
  const parents = new Map(messages.map((node) => [node.message.id, node.parentId]))
  assert.equal(parents.get('a2'), 'u2')
  assert.equal(parents.get('a2b'), 'u2')
  assert.equal(parents.get('u1b'), null)

  assert.equal((await run(store.get('alice', id))).title, 'First question')
})

test('A parent that is not stored is a conflict', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))

  const turn = Effect.scoped(store.beginTurn('alice', id, user('u1', 'Hi'), 'missing'))
  assert.equal(await failure(turn), 'ConversationConflict')

  // The failed turn does not hold up the next one.
  await completeTurn(store, id, user('u1', 'Hi'), null, assistant('a1', 'Hello'))
  assert.equal(await nodeCount(store, id), 2)

  // A stored message id cannot move to another parent.
  const moved = Effect.scoped(store.beginTurn('alice', id, user('u1', 'Hi'), 'a1'))
  assert.equal(await failure(moved), 'ConversationConflict')
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

test('An abandoned turn stops blocking after the grace period and keeps a late response off the head', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))
  const abandoned = await openTurn(store, id, user('u1', 'Hi'), null)
  await abandoned.close()

  await completeTurn(store, id, user('u1b', 'Again'), null, assistant('a1b', 'Hello'))

  // The abandoned response finishes after the newer turn.
  await run(abandoned.turn.finish([...abandoned.turn.messages, assistant('a1', 'Late')]))

  assert.deepEqual(await headBranch(store, id), ['u1b', 'a1b'], 'The newer turn keeps the head')

  const { messages } = await run(store.messages('alice', id))
  const late = messages.find((node) => node.message.id === 'a1')
  assert.equal(late?.parentId, 'u1', 'The late response is kept on its own branch')
})

test('An empty response is not stored', async () => {
  const { store } = setup()
  const id = await run(store.create('alice'))
  const { turn, close } = await openTurn(store, id, user('u1', 'Hi'), null)

  await run(turn.finish([...turn.messages, { id: 'a1', role: 'assistant', parts: [] }]))
  await close()

  assert.deepEqual(await headBranch(store, id), ['u1'])
})
