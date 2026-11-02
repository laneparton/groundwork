import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { UIMessage } from 'ai'
import { Context, Effect, Layer, Schema } from 'effect'
import { z } from 'zod'
import { Database } from '../db/service.ts'

// Conversations live beside the Better Auth tables so each one belongs to a user.
// The server owns persistence: it stores the client's messages when a chat
// request arrives and the full conversation when the response stream ends.
const schema = `
  CREATE TABLE IF NOT EXISTS conversation (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'archived')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS conversation_user_updated ON conversation (userId, updatedAt DESC);
  CREATE TABLE IF NOT EXISTS conversation_message (
    conversationId TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    message TEXT NOT NULL,
    PRIMARY KEY (conversationId, position)
  );
`

const titleLength = 60

export class ConversationNotFound extends Schema.TaggedError<ConversationNotFound>()(
  'ConversationNotFound',
  { message: Schema.String },
) {}

export const ConversationStatus = z.enum(['regular', 'archived'])

const conversationRow = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: ConversationStatus,
  updatedAt: z.string(),
})

const messageRow = z.object({ message: z.string() })

export type ConversationSummary = z.infer<typeof conversationRow>

export interface ConversationChanges {
  title?: string | undefined
  status?: z.infer<typeof ConversationStatus> | undefined
}

function titleFrom(messages: UIMessage[]) {
  const text = messages
    .find((message) => message.role === 'user')
    ?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return null

  return text.length > titleLength ? text.slice(0, titleLength - 1).trimEnd() + '…' : text
}

function createConversationStore(db: DatabaseSync) {
  db.exec(schema)

  const insert = db.prepare(
    'INSERT INTO conversation (id, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
  )

  const list = db.prepare(
    'SELECT id, title, status, updatedAt FROM conversation WHERE userId = ? ORDER BY updatedAt DESC',
  )

  const find = db.prepare(
    'SELECT id, title, status, updatedAt FROM conversation WHERE id = ? AND userId = ?',
  )

  const messages = db.prepare(
    'SELECT message FROM conversation_message WHERE conversationId = ? ORDER BY position',
  )

  const clearMessages = db.prepare('DELETE FROM conversation_message WHERE conversationId = ?')

  const insertMessage = db.prepare(
    'INSERT INTO conversation_message (conversationId, position, message) VALUES (?, ?, ?)',
  )

  const touch = db.prepare(
    'UPDATE conversation SET updatedAt = ?, title = COALESCE(title, ?) WHERE id = ? AND userId = ?',
  )

  const update = db.prepare(
    'UPDATE conversation SET title = COALESCE(?, title), status = COALESCE(?, status) WHERE id = ? AND userId = ?',
  )

  const remove = db.prepare('DELETE FROM conversation WHERE id = ? AND userId = ?')

  function get(userId: string, id: string) {
    const row = find.get(id, userId)

    return row ? conversationRow.parse(row) : undefined
  }

  return {
    create(userId: string) {
      const id = randomUUID()
      const now = new Date().toISOString()
      insert.run(id, userId, now, now)

      return id
    },

    list(userId: string) {
      return list.all(userId).map((row) => conversationRow.parse(row))
    },

    get,

    messages(userId: string, id: string): UIMessage[] | undefined {
      if (!get(userId, id)) return undefined

      return messages.all(id).map((row) => {
        const stored = messageRow.parse(row).message

        // SAFETY: saveMessages only writes messages that passed validateUIMessages
        // or came from the AI SDK response stream, so each row decodes to a UIMessage.
        return JSON.parse(stored) as UIMessage
      })
    },

    /** Replaces the stored messages. Returns false when the user does not own the conversation. */
    saveMessages(userId: string, id: string, conversation: UIMessage[]) {
      if (!get(userId, id)) return false

      db.exec('BEGIN IMMEDIATE')

      try {
        clearMessages.run(id)

        for (const [position, message] of conversation.entries()) {
          insertMessage.run(id, position, JSON.stringify(message))
        }

        touch.run(new Date().toISOString(), titleFrom(conversation), id, userId)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }

      return true
    },

    update(userId: string, id: string, changes: ConversationChanges) {
      return update.run(changes.title ?? null, changes.status ?? null, id, userId).changes > 0
    },

    remove(userId: string, id: string) {
      return remove.run(id, userId).changes > 0
    },
  }
}

export class ConversationStore extends Context.Service<
  ConversationStore,
  ReturnType<typeof createConversationStore>
>()('groundwork/ConversationStore') {}

export const ConversationStoreLive = Layer.effect(ConversationStore)(
  Effect.gen(function* () {
    const db = yield* Database

    return createConversationStore(db)
  }),
)
