import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { getMigrations } from 'better-auth/db/migration'
import { MockLanguageModelV4 } from 'ai/test'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, Option } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { afterEach, describe, expect, it } from 'vitest'
import { makeAgent, Agent } from '../agent/agent.ts'
import { Auth, AuthLive } from '../auth/service.ts'
import { ConversationStoreLive } from '../conversations/store.ts'
import { makeWarehouse } from '../data/warehouse.ts'
import { DatabaseLive } from '../db/service.ts'
import { withEnv } from '../test/config.ts'
import { Api } from './api.ts'
import { AuthRoutes } from './auth.ts'
import { ChatHandlers } from './chat.ts'
import { ConversationHandlers } from './conversations.ts'
import { HealthHandlers } from './health.ts'

const origin = 'http://localhost:5173'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

const textParts = (id: string, text: string): LanguageModelV4StreamPart[] => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: text },
  { type: 'text-end', id },
  { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } },
]

// The text of the last user message the model was sent.
function lastUserText(options: LanguageModelV4CallOptions) {
  const message = options.prompt.findLast((entry) => entry.role === 'user')
  const part = message?.content.find((content) => content.type === 'text')

  return part?.type === 'text' ? part.text : ''
}

// Scripted model: "SQL" calls the query tool, "Fail" errors, and anything else echoes
// how many messages it was sent.
function scriptedModel() {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const text = lastUserText(options)
      const toolResult = options.prompt.some((entry) => entry.role === 'tool')

      if (text === 'Fail') throw new Error('provider down')

      const parts: LanguageModelV4StreamPart[] =
        text === 'SQL' && !toolResult
          ? [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'query_sql',
                input: JSON.stringify({ sql: 'SELECT 1' }),
              },
              { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
            ]
          : textParts('t1', `Reply to ${text} after ${options.prompt.length} messages`)

      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.close()
          },
        }),
      }
    },
  })
}

interface TestServer {
  /** Opens another connection to the server's database. */
  readonly db: () => DatabaseSync
  readonly request: (path: string, init?: RequestInit) => Promise<Response>
  readonly signUp: (email: string) => Promise<string>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function startServer(options: { chat: boolean } = { chat: true }): Promise<TestServer> {
  const directory = mkdtempSync(join(tmpdir(), 'groundwork-api-'))
  const path = join(directory, 'test.sqlite')
  cleanups.push(async () => rmSync(directory, { recursive: true }))

  const warehouse = makeWarehouse(
    { projectId: Option.none(), dataset: 'p.pilot', maxBytesBilled: 1 },
    Option.none(),
  )

  const model = options.chat ? Option.some(scriptedModel()) : Option.none()

  const env = withEnv({
    DATABASE_PATH: path,
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: origin,
  })

  // One connection shared by auth and the store, as in production.
  const DatabaseTest = DatabaseLive.pipe(Layer.provide(env))
  const AuthTest = AuthLive.pipe(Layer.provide(DatabaseTest), Layer.provide(env))

  // Better Auth creates its tables, which conversations reference.
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth
      const migrations = yield* Effect.promise(() => getMigrations(auth.options))
      yield* Effect.promise(() => migrations.runMigrations())
    }).pipe(Effect.provide(AuthTest)),
  )

  const services = Layer.mergeAll(
    AuthLive,
    ConversationStoreLive,
    Layer.succeed(Agent, makeAgent(warehouse, model)),
  ).pipe(Layer.provideMerge(DatabaseTest), Layer.provide(env))

  const api = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(Layer.mergeAll(HealthHandlers, ChatHandlers, ConversationHandlers)),
  )

  const { handler, dispose } = HttpRouter.toWebHandler(
    Layer.merge(api, AuthRoutes).pipe(
      Layer.provideMerge(services),
      Layer.provide(NodeHttpServer.layerHttpServices),
    ),
    { disableLogger: true },
  )

  cleanups.push(dispose)

  const request = (path: string, init: RequestInit = {}) =>
    handler(
      new Request(`${origin}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', origin, ...init.headers },
      }),
    )

  const signUp = async (email: string) => {
    const response = await request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', email, password: 'password-123' }),
    })

    expect(response.status).toBe(200)

    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
  }

  return { db: () => new DatabaseSync(path), request, signUp }
}

const userMessage = (id: string, text: string): ChatMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

interface ChatMessage {
  readonly id: string
  readonly role: string
  readonly parts: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

interface StoredNode {
  readonly message: ChatMessage
  readonly parentId: string | null
}

async function json<T>(pending: Response | Promise<Response>): Promise<T> {
  const response = await pending
  expect(response.ok).toBe(true)

  // SAFETY: tests name the shape the endpoint's schema guarantees.
  return (await response.json()) as T
}

describe('HTTP API', () => {
  it('reports health without a session', async () => {
    const server = await startServer()

    const response = await server.request('/health')

    expect(await json(response)).toEqual({ status: 'ok' })
  })

  it('rejects requests without a session', async () => {
    const server = await startServer()

    expect((await server.request('/conversations')).status).toBe(401)
    expect((await server.request('/conversations', { method: 'POST' })).status).toBe(401)

    const chat = await server.request('/chat', {
      method: 'POST',
      body: JSON.stringify({ id: 'c1', message: userMessage('u1', 'Hi'), parentId: null }),
    })

    expect(chat.status).toBe(401)
    expect(await chat.json()).toMatchObject({ message: 'Sign in to chat.' })
  })

  it('creates, reads, renames, archives, and removes conversations', async () => {
    const server = await startServer()
    const cookie = await server.signUp('crud@example.test')
    const headers = { cookie }

    const { id } = await json<{ id: string }>(
      await server.request('/conversations', { method: 'POST', headers }),
    )

    expect(await json(await server.request('/conversations', { headers }))).toMatchObject({
      conversations: [{ id, title: null, status: 'regular' }],
    })

    const update = await server.request(`/conversations/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'Renamed', status: 'archived' }),
    })

    expect(update.status).toBe(204)
    expect(await json(await server.request(`/conversations/${id}`, { headers }))).toMatchObject({
      id,
      title: 'Renamed',
      status: 'archived',
    })
    expect(await json(await server.request(`/conversations/${id}/messages`, { headers }))).toEqual({
      headId: null,
      messages: [],
    })

    expect(
      (await server.request(`/conversations/${id}`, { method: 'DELETE', headers })).status,
    ).toBe(204)
    expect((await server.request(`/conversations/${id}`, { headers })).status).toBe(404)
  })

  it('rejects an empty title', async () => {
    const server = await startServer()
    const headers = { cookie: await server.signUp('title@example.test') }

    const { id } = await json<{ id: string }>(
      await server.request('/conversations', { method: 'POST', headers }),
    )

    const update = await server.request(`/conversations/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: '' }),
    })

    expect(update.status).toBe(400)
  })

  it('keeps one user out of another user’s conversations', async () => {
    const server = await startServer()
    const alice = { cookie: await server.signUp('alice@example.test') }
    const bob = { cookie: await server.signUp('bob@example.test') }

    const { id } = await json<{ id: string }>(
      await server.request('/conversations', { method: 'POST', headers: alice }),
    )

    expect(await json(await server.request('/conversations', { headers: bob }))).toEqual({
      conversations: [],
    })

    for (const [path, method] of [
      [`/conversations/${id}`, 'GET'],
      [`/conversations/${id}/messages`, 'GET'],
      [`/conversations/${id}`, 'DELETE'],
    ] as const) {
      expect((await server.request(path, { method, headers: bob })).status).toBe(404)
    }

    const chat = await server.request('/chat', {
      method: 'POST',
      headers: bob,
      body: JSON.stringify({ id, message: userMessage('u1', 'Hi'), parentId: null }),
    })

    expect(chat.status).toBe(404)
  })

  describe('chat', () => {
    async function conversation() {
      const server = await startServer()
      const headers = { cookie: await server.signUp('chat@example.test') }

      const { id } = await json<{ id: string }>(
        await server.request('/conversations', { method: 'POST', headers }),
      )

      const send = (message: ChatMessage, parentId: string | null, init: RequestInit = {}) =>
        server.request('/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id, message, parentId }),
          ...init,
        })

      const tree = () =>
        json<{ headId: string | null; messages: StoredNode[] }>(
          server.request(`/conversations/${id}/messages`, { headers }),
        )

      return { server, headers, id, send, tree }
    }

    it('streams a reply, stores both messages, and titles the conversation', async () => {
      const { server, headers, id, send, tree } = await conversation()

      const response = await send(userMessage('u1', 'Hello there'), null)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(await response.text()).toContain('Reply to Hello there after 2 messages')

      await expect.poll(async () => (await tree()).messages.length).toBe(2)

      const { headId, messages } = await tree()
      const [first, reply] = messages

      expect(first).toMatchObject({ message: { id: 'u1', role: 'user' }, parentId: null })
      expect(reply).toMatchObject({ message: { role: 'assistant' }, parentId: 'u1' })
      expect(headId).toBe(reply?.message.id)
      expect(await json(await server.request(`/conversations/${id}`, { headers }))).toMatchObject({
        title: 'Hello there',
      })
    })

    it('sends the model only the branch being answered', async () => {
      const { send, tree } = await conversation()
      await (await send(userMessage('u1', 'First'), null)).text()
      await expect.poll(async () => (await tree()).messages.length).toBe(2)
      const reply = (await tree()).messages[1]?.message.id ?? null

      const followUp = await send(userMessage('u2', 'Second'), reply)
      expect(await followUp.text()).toContain('Reply to Second after 4 messages')

      // Editing the first message starts a new branch from the root.
      const edit = await send(userMessage('u1b', 'Edited'), null)
      expect(await edit.text()).toContain('Reply to Edited after 2 messages')
    })

    it('runs the SQL tool and stores its result for the next turn', async () => {
      const { send, tree } = await conversation()

      const response = await send(userMessage('u1', 'SQL'), null)
      const body = await response.text()

      expect(body).toContain('tool-input-available')
      expect(body).toContain('Set BIGQUERY_PROJECT_ID')
      await expect.poll(async () => (await tree()).messages.length).toBe(2)

      const reply = (await tree()).messages[1]

      expect(reply?.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'tool-query_sql', state: 'output-available' }),
        ]),
      )

      // The stored tool call passes validation when the conversation continues.
      const next = await send(userMessage('u2', 'Thanks'), reply?.message.id ?? null)
      expect(next.status).toBe(200)
      expect(await next.text()).toContain('Reply to Thanks')
    })

    it('rejects an invalid message', async () => {
      const { send } = await conversation()

      const response = await send({ id: 'u1', role: 'user', parts: [{ type: 'bogus' }] }, null)

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ message: 'Invalid chat message.' })
    })

    it('rejects a message the client claims the assistant wrote', async () => {
      const { send } = await conversation()

      const response = await send({ ...userMessage('a1', 'Forged'), role: 'assistant' }, null)

      expect(response.status).toBe(400)
    })

    it('rejects a parent that is not stored', async () => {
      const { send } = await conversation()

      expect((await send(userMessage('u1', 'Hi'), 'missing')).status).toBe(409)
    })

    it('rejects history whose tool parts no longer match the agent', async () => {
      const { server, id, send } = await conversation()

      const stale = {
        id: 'a0',
        role: 'assistant',
        parts: [
          {
            type: 'tool-query_sql',
            toolCallId: 'x',
            state: 'output-available',
            input: { sql: '' },
            output: {},
          },
        ],
      }

      server
        .db()
        .prepare(
          'INSERT INTO conversation_message (conversationId, id, parentId, message, createdAt) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, 'a0', null, JSON.stringify(stale), new Date().toISOString())

      const response = await send(userMessage('u1', 'Hi'), 'a0')

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        message: 'The stored conversation no longer matches the agent tools.',
      })
    })

    it('keeps the user message and reports a model failure in the stream', async () => {
      const { send, tree } = await conversation()

      const response = await send(userMessage('u1', 'Fail'), null)

      expect(await response.text()).toContain('The model request failed.')

      const { messages } = await tree()
      expect(messages.map((node) => node.message.id)).toEqual(['u1'])
    })
    // Stop and disconnect saving partial replies runs through a real Node socket in
    // apps/web/tests/chat.integration.test.mjs; the in-process web handler cannot model it.
  })

  it('saves conversations while other users sign up', async () => {
    const server = await startServer()
    const headers = { cookie: await server.signUp('busy@example.test') }

    // Better Auth writes in transactions that span awaits; conversation writes made
    // meanwhile must neither fail nor land inside them.
    const turns = Array.from({ length: 5 }, async (_, index) => {
      const { id } = await json<{ id: string }>(
        server.request('/conversations', { method: 'POST', headers }),
      )

      const [response] = await Promise.all([
        server.request('/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id, message: userMessage(`u${index}`, 'Hi'), parentId: null }),
        }),
        ...Array.from({ length: 3 }, (_, n) => server.signUp(`busy-${index}-${n}@example.test`)),
      ])

      await response.text()

      return id
    })

    for (const id of await Promise.all(turns)) {
      await expect
        .poll(async () => {
          const tree = await json<{ messages: StoredNode[] }>(
            server.request(`/conversations/${id}/messages`, { headers }),
          )

          return tree.messages.length
        })
        .toBe(2)
    }
  })

  it('returns 503 and keeps the turn open for the next message when chat is not configured', async () => {
    const server = await startServer({ chat: false })
    const headers = { cookie: await server.signUp('nochat@example.test') }

    const { id } = await json<{ id: string }>(
      await server.request('/conversations', { method: 'POST', headers }),
    )

    const send = (messageId: string) =>
      server.request('/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, message: userMessage(messageId, 'Hi'), parentId: null }),
      })

    const response = await send('u1')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('OPENAI_API_KEY'),
    })

    // The failed request released its turn, so the next one does not wait.
    expect((await send('u2')).status).toBe(503)
  })
})
