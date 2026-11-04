import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConversation,
  deleteConversation,
  getConversation,
  getConversationMessages,
  listConversations,
  updateConversation,
} from './api'

interface Call {
  readonly path: string
  readonly method: string
  readonly headers: Headers
  readonly body: string | null
}

// Answers every request with `status` and the JSON of `body`, and records what was sent.
function stubServer(body: string | null, status = 200) {
  const calls: Call[] = []

  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    calls.push({
      path,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body ? String(init.body) : null,
    })

    return new Response(body, { status })
  })

  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const summary = { id: 'c1', title: 'Hello', status: 'regular', updatedAt: '2026-11-03T00:00:00Z' }

describe('conversation API client', () => {
  it('lists conversations', async () => {
    const calls = stubServer(JSON.stringify({ conversations: [summary] }))

    expect(await listConversations()).toEqual([summary])
    expect(calls[0]).toMatchObject({ path: '/conversations', method: 'GET' })
    expect(calls[0]?.headers.get('content-type')).toBe('application/json')
  })

  it('rejects a response that does not match the contract', async () => {
    stubServer(JSON.stringify({ conversations: [{ ...summary, status: 'deleted' }] }))

    await expect(listConversations()).rejects.toThrow()
  })

  it('creates a conversation and returns its id', async () => {
    const calls = stubServer(JSON.stringify({ id: 'c2' }))

    expect(await createConversation()).toBe('c2')
    expect(calls[0]).toMatchObject({ path: '/conversations', method: 'POST' })
  })

  it('gets one conversation, encoding its id', async () => {
    const calls = stubServer(JSON.stringify({ ...summary, title: null }))

    expect(await getConversation('a/b')).toEqual({ ...summary, title: null })
    expect(calls[0]?.path).toBe('/conversations/a%2Fb')
  })

  it('loads the message tree', async () => {
    const tree = {
      headId: 'a1',
      messages: [
        {
          message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
          parentId: null,
        },
        { message: { id: 'a1', role: 'assistant', parts: [], metadata: { x: 1 } }, parentId: 'u1' },
      ],
    }

    const calls = stubServer(JSON.stringify(tree))

    expect(await getConversationMessages('c1')).toEqual(tree)
    expect(calls[0]?.path).toBe('/conversations/c1/messages')
  })

  it.each([
    { id: 'u1', role: 'tool', parts: [] },
    { id: 'u1', role: 'user' },
    { role: 'user', parts: [] },
    { id: 'u1', role: 'user', parts: [{ text: 'no type' }] },
  ])('rejects a stored message with the wrong shape: %o', async (message) => {
    stubServer(JSON.stringify({ headId: null, messages: [{ message, parentId: null }] }))

    await expect(getConversationMessages('c1')).rejects.toThrow()
  })

  it('updates a conversation', async () => {
    const calls = stubServer(null, 204)

    await updateConversation('c1', { title: 'Renamed', status: 'archived' })

    expect(calls[0]).toMatchObject({
      path: '/conversations/c1',
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed', status: 'archived' }),
    })
  })

  it('deletes a conversation', async () => {
    const calls = stubServer(null, 204)

    await deleteConversation('c1')

    expect(calls[0]).toMatchObject({ path: '/conversations/c1', method: 'DELETE' })
  })

  it('names the request and status when the server fails', async () => {
    stubServer(JSON.stringify({ message: 'nope' }), 404)

    await expect(getConversation('c1')).rejects.toThrow(
      'GET /conversations/c1 failed with status 404.',
    )
    await expect(deleteConversation('c1')).rejects.toThrow(
      'DELETE /conversations/c1 failed with status 404.',
    )
  })
})
