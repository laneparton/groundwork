import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AssistantChatTransport } from '@assistant-ui/ai-sdk'
import { readUIMessageStream } from 'ai'

test(
  'SQLite auth protects streamed chat and revokes sessions on sign-out',
  { timeout: 30000 },
  async (t) => {
    let providerInput
    let resolveCancelled

    const cancelled = new Promise((resolve) => {
      resolveCancelled = resolve
    })

    const provider = createServer(async (req, res) => {
      const chunks = []

      for await (const chunk of req) chunks.push(chunk)
      providerInput = JSON.parse(Buffer.concat(chunks).toString())
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })

      const events = [
        {
          type: 'response.created',
          response: { id: 'response-1', created_at: 0, model: 'test-model' },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message-1' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-1',
          output_index: 0,
          delta: 'Hello',
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-1',
          output_index: 0,
          delta: ' world',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message', id: 'message-1' },
        },
        { type: 'response.completed', response: {} },
      ]

      if (providerInput.input[0].content[0].text === 'Hold') {
        res.on('close', resolveCancelled)

        for (const event of events.slice(0, 3)) res.write(`data: ${JSON.stringify(event)}\n\n`)

        return
      }

      for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
      res.end()
    })

    provider.listen(0, '127.0.0.1')
    await once(provider, 'listening')
    t.after(() => {
      provider.closeAllConnections()
      provider.close()
    })

    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    const databaseDirectory = await mkdtemp(join(tmpdir(), 'groundwork-auth-'))
    t.after(() => rm(databaseDirectory, { recursive: true, force: true }))

    const serverOptions = {
      cwd: fileURLToPath(new URL('../../server/', import.meta.url)),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        OPENAI_API_KEY: 'test-key',
        CHAT_MODEL: 'test-model',
        OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
        AUTH_DATABASE_PATH: join(databaseDirectory, 'auth.sqlite'),
        BETTER_AUTH_SECRET: 'test-only-secret-at-least-thirty-two-characters',
        BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }

    await promisify(execFile)(process.execPath, ['src/auth/migrate.ts'], serverOptions)
    const server = spawn(process.execPath, ['src/main.ts'], serverOptions)
    t.after(async () => {
      if (server.exitCode === null) {
        server.kill('SIGTERM')
        await once(server, 'exit')
      }
    })
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('Listening on')) resolve()
      })
      server.once('exit', (code) => reject(new Error(`Server exited during startup: ${code}`)))
    })

    const api = `http://127.0.0.1:${port}`

    const chatBody = {
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    }

    const anonymous = await fetch(`${api}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody),
    })

    assert.equal(anonymous.status, 401)
    assert.equal(providerInput, undefined, 'Anonymous requests do not call the model')

    const credentials = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'test-password-1234',
    }

    const signup = await fetch(`${api}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify(credentials),
    })

    assert.equal(signup.status, 200, await signup.clone().text())
    assert.ok(signup.headers.getSetCookie().some((cookie) => /httponly/i.test(cookie)))

    const foreignOrigin = await fetch(`${api}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify(credentials),
    })

    assert.equal(foreignOrigin.status, 403)

    const wrongPassword = await fetch(`${api}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: api },
      body: JSON.stringify({ email: credentials.email, password: 'wrong-password' }),
    })

    assert.equal(wrongPassword.status, 401)

    const signin = await fetch(`${api}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: api },
      body: JSON.stringify(credentials),
    })

    assert.equal(signin.status, 200)

    const cookie = signin.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')

    assert.ok(cookie)
    const session = await fetch(`${api}/api/auth/get-session`, { headers: { Cookie: cookie } })
    assert.equal((await session.json()).user.email, credentials.email)

    const transport = new AssistantChatTransport({
      api: `${api}/chat`,
      headers: { Cookie: cookie },
    })

    const stream = await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      abortSignal: new AbortController().signal,
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    })

    const outputs = []

    for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
      outputs.push(
        message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      )
    }

    assert.ok(outputs.includes('Hello'), 'First text delta reaches the client')
    assert.equal(outputs.at(-1), 'Hello world')
    assert.equal(providerInput.model, 'test-model')
    assert.equal(providerInput.input[0].content[0].text, 'Hi')

    const invalid = await fetch(`${api}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ messages: [{ id: 'bad', role: 'user', parts: 'invalid' }] }),
    })

    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json())._tag, 'InvalidChatRequest')

    const controller = new AbortController()

    const ongoing = await transport.sendMessages({
      chatId: 'chat-2',
      trigger: 'submit-message',
      abortSignal: controller.signal,
      messages: [{ id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'Hold' }] }],
    })

    const reader = ongoing.getReader()

    while ((await reader.read()).value?.type !== 'text-delta') {
      /* Wait for the first token. */
    }

    controller.abort()
    await cancelled

    const signout = await fetch(`${api}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: api },
      body: '{}',
    })

    assert.equal(signout.status, 200)

    const revoked = await fetch(`${api}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(chatBody),
    })

    assert.equal(revoked.status, 401, 'Signed-out sessions cannot call chat')
  },
)
