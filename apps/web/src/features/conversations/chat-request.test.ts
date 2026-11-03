import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { prepareSendMessagesRequest } from './chat-request'

const message = (id: string, role: UIMessage['role']): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text: id }],
})

const prepare = (messages: UIMessage[]) =>
  prepareSendMessagesRequest({
    id: 'c1',
    messages,
    requestMetadata: undefined,
    body: undefined,
    credentials: undefined,
    headers: undefined,
    api: '/chat',
    trigger: 'submit-message',
    messageId: undefined,
  })

describe('prepareSendMessagesRequest', () => {
  it('sends only the new message and the id of the message it follows', async () => {
    const messages = [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user')]

    expect(await prepare(messages)).toEqual({
      body: { id: 'c1', message: messages[2], parentId: 'a1' },
    })
  })

  it('sends a null parent for the first message', async () => {
    const first = message('u1', 'user')

    expect(await prepare([first])).toEqual({ body: { id: 'c1', message: first, parentId: null } })
  })
})
