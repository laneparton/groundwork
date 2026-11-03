import type { UIMessage } from 'ai'
import { z } from 'zod'

// Same-origin requests go through the Vite proxy during development.
const ConversationStatus = z.enum(['regular', 'archived'])

const ConversationSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: ConversationStatus,
  updatedAt: z.string(),
})

const StoredMessage = z.looseObject({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.looseObject({ type: z.string() })),
})

// The server only stores messages validated by the AI SDK; this guards the shape.
const ConversationMessages = z.object({
  messages: z.array(z.custom<UIMessage>((value) => StoredMessage.safeParse(value).success)),
})

export type ConversationSummary = z.infer<typeof ConversationSummary>

export interface ConversationChanges {
  title?: string
  status?: z.infer<typeof ConversationStatus>
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed with status ${response.status}.`)
  }

  return response
}

const conversationPath = (id: string) => `/conversations/${encodeURIComponent(id)}`

export async function listConversations() {
  const response = await request('/conversations')

  return z.object({ conversations: z.array(ConversationSummary) }).parse(await response.json())
    .conversations
}

export async function createConversation() {
  const response = await request('/conversations', { method: 'POST' })

  return z.object({ id: z.string() }).parse(await response.json()).id
}

export async function getConversation(id: string) {
  const response = await request(conversationPath(id))

  return ConversationSummary.parse(await response.json())
}

export async function getConversationMessages(id: string) {
  const response = await request(`${conversationPath(id)}/messages`)

  return ConversationMessages.parse(await response.json()).messages
}

export async function updateConversation(id: string, changes: ConversationChanges) {
  await request(conversationPath(id), { method: 'PATCH', body: JSON.stringify(changes) })
}

export async function deleteConversation(id: string) {
  await request(conversationPath(id), { method: 'DELETE' })
}
