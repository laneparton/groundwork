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

const ConversationStatus = z.enum(['regular', 'archived'])

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

const notFound = new ConversationNotFound({ message: 'Conversation not found.' })

export class ConversationStore extends Context.Service<
  ConversationStore,
  {
    readonly create: (userId: string) => Effect.Effect<string>
    /** Lists the user's conversations, most recently updated first. */
    readonly list: (userId: string) => Effect.Effect<ConversationSummary[]>
    readonly get: (
      userId: string,
      id: string,
    ) => Effect.Effect<ConversationSummary, ConversationNotFound>
    readonly messages: (
      userId: string,
      id: string,
    ) => Effect.Effect<UIMessage[], ConversationNotFound>
    /** Replaces the stored messages and titles the conversation from its first user turn. */
    readonly saveMessages: (
      userId: string,
      id: string,
      messages: UIMessage[],
    ) => Effect.Effect<void, ConversationNotFound>
    readonly update: (
      userId: string,
      id: string,
      changes: ConversationChanges,
    ) => Effect.Effect<void, ConversationNotFound>
    readonly remove: (userId: string, id: string) => Effect.Effect<void, ConversationNotFound>
  }
>()('groundwork/ConversationStore') {}

// Every lookup is scoped to the user, so another user's conversation reads as not found.
function prepareStatements(db: DatabaseSync) {
  db.exec(schema)

  return {
    insert: db.prepare(
      'INSERT INTO conversation (id, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
    ),
    list: db.prepare(
      'SELECT id, title, status, updatedAt FROM conversation WHERE userId = ? ORDER BY updatedAt DESC',
    ),
    find: db.prepare(
      'SELECT id, title, status, updatedAt FROM conversation WHERE id = ? AND userId = ?',
    ),
    messages: db.prepare(
      'SELECT message FROM conversation_message WHERE conversationId = ? ORDER BY position',
    ),
    clearMessages: db.prepare('DELETE FROM conversation_message WHERE conversationId = ?'),
    insertMessage: db.prepare(
      'INSERT INTO conversation_message (conversationId, position, message) VALUES (?, ?, ?)',
    ),
    touch: db.prepare(
      'UPDATE conversation SET updatedAt = ?, title = COALESCE(title, ?) WHERE id = ? AND userId = ?',
    ),
    update: db.prepare(
      'UPDATE conversation SET title = COALESCE(?, title), status = COALESCE(?, status) WHERE id = ? AND userId = ?',
    ),
    remove: db.prepare('DELETE FROM conversation WHERE id = ? AND userId = ?'),
  }
}

export const ConversationStoreLive = Layer.effect(ConversationStore)(
  Effect.gen(function* () {
    const db = yield* Database
    const statements = yield* Effect.sync(() => prepareStatements(db))

    const get = (userId: string, id: string) =>
      Effect.flatMap(
        Effect.sync(() => statements.find.get(id, userId)),
        (row) => (row ? Effect.succeed(conversationRow.parse(row)) : Effect.fail(notFound)),
      )

    const requireChange = (changes: number | bigint) =>
      changes > 0 ? Effect.void : Effect.fail(notFound)

    return {
      create: (userId) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = new Date().toISOString()
          statements.insert.run(id, userId, now, now)

          return id
        }),

      list: (userId) =>
        Effect.sync(() => statements.list.all(userId).map((row) => conversationRow.parse(row))),

      get,

      messages: (userId, id) =>
        Effect.andThen(
          get(userId, id),
          Effect.sync(() =>
            statements.messages.all(id).map((row) => {
              const stored = messageRow.parse(row).message

              // SAFETY: saveMessages only writes messages that passed validateUIMessages
              // or came from the AI SDK response stream, so each row decodes to a UIMessage.
              return JSON.parse(stored) as UIMessage
            }),
          ),
        ),

      saveMessages: (userId, id, messages) =>
        Effect.andThen(
          get(userId, id),
          Effect.sync(() => {
            db.exec('BEGIN IMMEDIATE')

            try {
              statements.clearMessages.run(id)

              for (const [position, message] of messages.entries()) {
                statements.insertMessage.run(id, position, JSON.stringify(message))
              }

              statements.touch.run(new Date().toISOString(), titleFrom(messages), id, userId)
              db.exec('COMMIT')
            } catch (error) {
              db.exec('ROLLBACK')
              throw error
            }
          }),
        ),

      update: (userId, id, changes) =>
        Effect.flatMap(
          Effect.sync(
            () =>
              statements.update.run(changes.title ?? null, changes.status ?? null, id, userId)
                .changes,
          ),
          requireChange,
        ),

      remove: (userId, id) =>
        Effect.flatMap(
          Effect.sync(() => statements.remove.run(id, userId).changes),
          requireChange,
        ),
    }
  }),
)
