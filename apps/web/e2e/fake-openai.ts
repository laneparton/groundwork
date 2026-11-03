// A stand-in for the OpenAI Responses API. It streams "Reply to <last user text>", and
// a message containing SLOW streams one word every 300 ms so a test can press Stop.
import { createServer } from 'node:http'

interface InputItem {
  readonly role?: string
  readonly content?: ReadonlyArray<{ readonly text?: string }> | string
}

// The Responses API stream events the AI SDK reads.
interface ResponseEvent {
  readonly type: string
  readonly response?: {
    readonly id?: string
    readonly created_at?: number
    readonly model?: string
  }
  readonly output_index?: number
  readonly item?: { readonly type: string; readonly id: string }
  readonly item_id?: string
  readonly delta?: string
}

const textOf = (item: InputItem | undefined) =>
  Array.isArray(item?.content) ? item.content.map((part) => part.text ?? '').join('') : ''

const port = Number(process.env['FAKE_OPENAI_PORT'] ?? 4011)
let responses = 0

createServer(async (request, response) => {
  const chunks: Buffer[] = []

  for await (const chunk of request) chunks.push(Buffer.from(chunk))

  const body: { input: InputItem[] } = JSON.parse(Buffer.concat(chunks).toString())
  const last = textOf(body.input.findLast((item) => item.role === 'user'))
  const slow = last.includes('SLOW')
  const id = `msg-${++responses}`
  const words = [`Reply to "${last}" after ${body.input.length} items.`]

  if (slow) words.push(...'one two three four five six seven eight nine ten'.split(' '))

  response.writeHead(200, { 'content-type': 'text/event-stream' })

  const send = (event: ResponseEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`)
  let closed = false
  response.on('close', () => (closed = true))

  send({
    type: 'response.created',
    response: { id: `resp-${responses}`, created_at: 0, model: 'fake' },
  })
  send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id } })

  for (const word of words) {
    if (closed) return

    send({ type: 'response.output_text.delta', item_id: id, output_index: 0, delta: `${word} ` })
    await new Promise((resolve) => setTimeout(resolve, slow ? 300 : 5))
  }

  send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id } })
  send({ type: 'response.completed', response: {} })
  response.end()
}).listen(port, '127.0.0.1')
