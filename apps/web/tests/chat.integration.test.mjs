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
  'Auth protects streamed chat, SQL tool round trips, and cancellation',
  { timeout: 30000 },
  async (t) => {
    let providerInput
    let bigqueryInput
    let sqlFollowup
    let heldQuery
    let resolveSqlStarted
    let resolveSqlCancelled

    const sqlStarted = new Promise((resolve) => {
      resolveSqlStarted = resolve
    })

    const sqlCancelled = new Promise((resolve) => {
      resolveSqlCancelled = resolve
    })

    let resolveCancelled

    const cancelled = new Promise((resolve) => {
      resolveCancelled = resolve
    })

    const provider = createServer(async (req, res) => {
      const chunks = []

      for await (const chunk of req) chunks.push(chunk)

      if (req.url.startsWith('/bigquery/')) {
        res.setHeader('Content-Type', 'application/json')

        if (new URL(req.url, 'http://localhost').pathname.endsWith('/cancel')) {
          heldQuery?.end(JSON.stringify({ jobComplete: true, totalRows: '0', rows: [] }))
          res.end(JSON.stringify({ job: { status: { state: 'DONE' } } }))
          resolveSqlCancelled()

          return
        }

        if (req.method === 'POST') {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          bigqueryInput = body

          if (body.configuration.query.query.includes('INVALID_SQL_SENTINEL')) {
            res.statusCode = 400
            res.end(
              JSON.stringify({
                error: {
                  code: 400,
                  message: 'Unrecognized name: INVALID_SQL_SENTINEL',
                  errors: [
                    { reason: 'invalidQuery', message: 'Unrecognized name: INVALID_SQL_SENTINEL' },
                  ],
                },
              }),
            )

            return
          }

          res.end(
            JSON.stringify({
              jobReference: body.jobReference,
              statistics: { query: { statementType: 'SELECT' } },
              status: { state: 'DONE' },
            }),
          )
        } else {
          if (bigqueryInput.configuration.query.query.includes("'Hold'")) {
            heldQuery = res
            resolveSqlStarted()

            return
          }

          res.end(
            JSON.stringify({
              jobComplete: true,
              totalRows: '1',
              schema: {
                fields: [
                  { name: 'Name', type: 'STRING' },
                  { name: 'Version', type: 'STRING' },
                ],
              },
              rows: [{ f: [{ v: 'react' }, { v: '19.2.0' }] }],
            }),
          )
        }

        return
      }

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

      const userText = providerInput.input.find((item) => item.role === 'user')?.content[0].text
      const toolOutput = providerInput.input.find((item) => item.type === 'function_call_output')

      if (
        (userText === 'SQL' || userText === 'SQL hold' || userText === 'SQL error') &&
        !toolOutput
      ) {
        const item = {
          type: 'function_call',
          id: 'sql-item-1',
          call_id: 'sql-call-1',
          name: 'query_sql',
          status: 'completed',
          arguments: JSON.stringify({
            sql:
              userText === 'SQL hold'
                ? "SELECT 'Hold' AS Name"
                : userText === 'SQL error'
                  ? 'SELECT INVALID_SQL_SENTINEL'
                  : 'SELECT Name, Version FROM \u0060bigquery-public-data.deps_dev_v1.PackageVersionsLatest\u0060 WHERE System = "NPM" AND Name = "react" LIMIT 1',
          }),
        }

        const toolEvents = [
          events[0],
          { type: 'response.output_item.added', output_index: 0, item },
          {
            type: 'response.function_call_arguments.delta',
            item_id: item.id,
            output_index: 0,
            delta: item.arguments,
          },
          { type: 'response.output_item.done', output_index: 0, item },
          events.at(-1),
        ]

        for (const event of toolEvents) res.write('data: ' + JSON.stringify(event) + '\n\n')
        res.end()

        return
      }

      if (toolOutput) sqlFollowup = toolOutput

      if (userText === 'Hold') {
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
        BIGQUERY_PROJECT_ID: 'test-project',
        BIGQUERY_DATASET: 'bigquery-public-data.deps_dev_v1',
        BIGQUERY_EMULATOR_HOST: `http://127.0.0.1:${provider.address().port}/bigquery/v2`,
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
      id: 'conversation-before-sign-in',
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

    const authed = (path, init = {}) =>
      fetch(`${api}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init.headers },
      })

    const newConversation = async () => {
      const created = await authed('/conversations', { method: 'POST' })
      assert.equal(created.status, 200)

      return (await created.json()).id
    }

    const storedConversation = async (id) => {
      const response = await authed(`/conversations/${id}`)
      assert.equal(response.status, 200)

      return response.json()
    }

    const transport = new AssistantChatTransport({
      api: `${api}/chat`,
      headers: { Cookie: cookie },
    })

    const chatId = await newConversation()

    const stream = await transport.sendMessages({
      chatId: chatId,
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
    assert.equal(providerInput.input.find((item) => item.role === 'user').content[0].text, 'Hi')

    assert.ok(providerInput.tools.some((definition) => definition.name === 'query_sql'))

    const stored = await storedConversation(chatId)
    assert.equal(stored.title, 'Hi', 'The first user message titles the conversation')
    assert.deepEqual(
      stored.messages.map((message) => message.role),
      ['user', 'assistant'],
    )
    assert.equal(stored.messages[0].id, 'user-1')
    assert.ok(stored.messages[1].id, 'The server assigns the assistant message id')
    assert.ok(
      stored.messages[1].parts.some((part) => part.type === 'text' && part.text === 'Hello world'),
      'The finished response is saved',
    )

    const listed = await (await authed('/conversations')).json()
    assert.ok(listed.conversations.some((conversation) => conversation.id === chatId))

    const sqlChatId = await newConversation()

    const sqlStream = await transport.sendMessages({
      chatId: sqlChatId,
      trigger: 'submit-message',
      abortSignal: new AbortController().signal,
      messages: [{ id: 'sql-user', role: 'user', parts: [{ type: 'text', text: 'SQL' }] }],
    })

    let sqlMessage

    for await (const message of readUIMessageStream({
      stream: sqlStream,
      terminateOnError: true,
    })) {
      sqlMessage = message
    }

    const sqlPart = sqlMessage.parts.find((part) => part.type === 'tool-query_sql')
    assert.equal(sqlPart.state, 'output-available')
    assert.deepEqual(sqlPart.output, {
      rows: [{ Name: 'react', Version: '19.2.0' }],
      truncated: false,
    })
    assert.ok(bigqueryInput.configuration.query.query.includes('PackageVersionsLatest'))
    assert.equal(bigqueryInput.configuration.query.maximumBytesBilled, '20000000000')
    assert.equal(bigqueryInput.configuration.jobTimeoutMs, '30000')
    assert.deepEqual(JSON.parse(sqlFollowup.output), sqlPart.output)
    assert.ok(
      sqlMessage.parts.some((part) => part.type === 'text' && part.text === 'Hello world'),
      'The model answers after the SQL tool result',
    )

    const storedSql = await storedConversation(sqlChatId)
    const storedSqlPart = storedSql.messages[1].parts.find((part) => part.type === 'tool-query_sql')
    assert.deepEqual(storedSqlPart.output, sqlPart.output, 'Tool results are saved')

    const errorChatId = await newConversation()

    const errorStream = await transport.sendMessages({
      chatId: errorChatId,
      trigger: 'submit-message',
      abortSignal: new AbortController().signal,
      messages: [
        { id: 'sql-error-user', role: 'user', parts: [{ type: 'text', text: 'SQL error' }] },
      ],
    })

    let errorMessage

    for await (const message of readUIMessageStream({
      stream: errorStream,
      terminateOnError: true,
    })) {
      errorMessage = message
    }

    const errorPart = errorMessage.parts.find((part) => part.type === 'tool-query_sql')
    assert.match(errorPart.output.error, /Unrecognized name: INVALID_SQL_SENTINEL/)
    assert.doesNotMatch(errorPart.output.error, /model request failed/i)
    assert.deepEqual(JSON.parse(sqlFollowup.output), errorPart.output)

    const invalid = await fetch(`${api}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        id: chatId,
        messages: [{ id: 'bad', role: 'user', parts: 'invalid' }],
      }),
    })

    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json())._tag, 'InvalidChatRequest')

    const controller = new AbortController()

    const holdChatId = await newConversation()

    const ongoing = await transport.sendMessages({
      chatId: holdChatId,
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

    // The response stream ends after the abort reaches the server, so poll for the save.
    let storedHold = await storedConversation(holdChatId)

    for (let attempt = 0; attempt < 40 && storedHold.messages.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      storedHold = await storedConversation(holdChatId)
    }

    assert.equal(
      storedHold.messages[0].id,
      'user-2',
      'The user turn is saved before the model runs',
    )
    assert.equal(storedHold.messages[1]?.role, 'assistant', 'Stopping saves the partial response')
    assert.ok(
      storedHold.messages[1].parts.some(
        (part) => part.type === 'text' && part.text.startsWith('Hello'),
      ),
      'The partial response keeps the streamed text',
    )

    const sqlController = new AbortController()

    const sqlHoldChatId = await newConversation()

    const heldSqlStream = await transport.sendMessages({
      chatId: sqlHoldChatId,
      trigger: 'submit-message',
      abortSignal: sqlController.signal,
      messages: [
        { id: 'sql-hold-user', role: 'user', parts: [{ type: 'text', text: 'SQL hold' }] },
      ],
    })

    const heldSqlReader = heldSqlStream.getReader()

    const drainHeldSql = (async () => {
      try {
        while (!(await heldSqlReader.read()).done) {
          /* Drain until cancellation. */
        }
      } catch {
        /* Aborting the transport can reject the reader. */
      }
    })()

    await sqlStarted
    sqlController.abort()
    await sqlCancelled
    await drainHeldSql

    const unknownChat = await authed('/chat', {
      method: 'POST',
      body: JSON.stringify({ ...chatBody, id: 'missing-conversation' }),
    })

    assert.equal(unknownChat.status, 404, 'Chats require an existing conversation')

    const renamed = await authed(`/conversations/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed', status: 'archived' }),
    })

    assert.equal(renamed.status, 204)
    const updated = await storedConversation(chatId)
    assert.equal(updated.title, 'Renamed')
    assert.equal(updated.status, 'archived')

    const otherSignup = await fetch(`${api}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: api },
      body: JSON.stringify({
        name: 'Other User',
        email: 'other@example.com',
        password: 'other-password-1234',
      }),
    })

    assert.equal(otherSignup.status, 200)

    const otherCookie = otherSignup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')

    const otherHeaders = { 'Content-Type': 'application/json', Cookie: otherCookie }

    const othersList = await (await fetch(`${api}/conversations`, { headers: otherHeaders })).json()
    assert.deepEqual(othersList.conversations, [], 'Users only list their own conversations')

    for (const [method, path, body] of [
      ['GET', `/conversations/${chatId}`],
      ['PATCH', `/conversations/${chatId}`, { title: 'Stolen' }],
      ['DELETE', `/conversations/${chatId}`],
      ['POST', '/chat', { ...chatBody, id: chatId }],
    ]) {
      const response = await fetch(`${api}${path}`, {
        method,
        headers: otherHeaders,
        body: body && JSON.stringify(body),
      })

      assert.equal(response.status, 404, `${method} ${path} hides other users' conversations`)
    }

    const deleted = await authed(`/conversations/${chatId}`, { method: 'DELETE' })
    assert.equal(deleted.status, 204)
    assert.equal((await authed(`/conversations/${chatId}`)).status, 404)

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
    assert.equal((await authed('/conversations')).status, 401)
  },
)
