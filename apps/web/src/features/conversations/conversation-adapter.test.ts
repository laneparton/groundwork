import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationListAdapter as adapter } from './conversation-adapter'

const summary = {
  id: 'c1',
  title: 'Hello',
  status: 'regular',
  updatedAt: '2026-11-03T00:00:00.000Z',
}

// Routes `METHOD /path` to a response body ('' for no content) and records each request.
function stubServer(routes: Record<string, string>) {
  const calls: string[] = []

  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${path}`
    calls.push(init.body ? `${route} ${String(init.body)}` : route)
    const body = routes[route]

    return new Response(body || null, { status: body === undefined ? 404 : 200 })
  })

  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function streamText(stream: ReadableStream<object>) {
  const chunks: string[] = []

  for await (const chunk of stream) chunks.push(JSON.stringify(chunk))

  return chunks.join('')
}

describe('conversationListAdapter', () => {
  it('lists conversations as threads', async () => {
    stubServer({
      'GET /conversations': JSON.stringify({
        conversations: [summary, { ...summary, id: 'c2', title: null }],
      }),
    })

    expect(await adapter.list()).toEqual({
      threads: [
        {
          status: 'regular',
          remoteId: 'c1',
          title: 'Hello',
          lastMessageAt: new Date(summary.updatedAt),
        },
        {
          status: 'regular',
          remoteId: 'c2',
          title: undefined,
          lastMessageAt: new Date(summary.updatedAt),
        },
      ],
    })
  })

  it('creates a conversation for a new thread', async () => {
    stubServer({ 'POST /conversations': JSON.stringify({ id: 'c3' }) })

    expect(await adapter.initialize('local-1')).toEqual({ remoteId: 'c3' })
  })

  it('renames, archives, unarchives, and deletes through the API', async () => {
    const calls = stubServer({
      'PATCH /conversations/c1': '',
      'DELETE /conversations/c1': '',
    })

    await adapter.rename('c1', 'New name')
    await adapter.archive('c1')
    await adapter.unarchive('c1')
    await adapter.delete('c1')

    expect(calls).toEqual([
      'PATCH /conversations/c1 {"title":"New name"}',
      'PATCH /conversations/c1 {"status":"archived"}',
      'PATCH /conversations/c1 {"status":"regular"}',
      'DELETE /conversations/c1',
    ])
  })

  it('fetches one thread', async () => {
    stubServer({ 'GET /conversations/c1': JSON.stringify({ ...summary, status: 'archived' }) })

    expect(await adapter.fetch('c1')).toEqual({
      status: 'archived',
      remoteId: 'c1',
      title: 'Hello',
      lastMessageAt: new Date(summary.updatedAt),
    })
  })

  it('streams the title the server chose', async () => {
    stubServer({ 'GET /conversations/c1': JSON.stringify(summary) })

    expect(await streamText(await adapter.generateTitle('c1', []))).toContain('Hello')
  })

  it('streams nothing while the server has no title', async () => {
    stubServer({ 'GET /conversations/c1': JSON.stringify({ ...summary, title: null }) })

    expect(await streamText(await adapter.generateTitle('c1', []))).not.toContain('text-delta')
  })

  it('provides the server history to each thread', () => {
    expect(adapter.unstable_Provider).toBeTypeOf('function')
  })
})
