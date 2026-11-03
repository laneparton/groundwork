import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { UIMessage } from 'ai'
import { Context, Duration, Effect, Layer, Schema, Scope } from 'effect'
import { runMigrations, type Migration } from '../db/migrations.ts'
import { Database } from '../db/service.ts'
import {
  ConversationChanges,
  ConversationConflict,
  ConversationNotFound,
  ConversationSummary,
} from './schema.ts'
import { createTurnQueue } from './turn-queue.ts'

// Conversations live beside the Better Auth tables so each one belongs to a user.
// Append new migrations; never edit one that has shipped.
const migrations: ReadonlyArray<Migration> = [
  {
    name: 'conversations-001-create',
    // IF NOT EXISTS adopts databases created before migrations were tracked.
    sql: `
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
    `,
  },
]

const titleLength = 60

// How long after its request closes a turn still waits for its response to be saved.
const defaultAbandonedTurnGrace = Duration.seconds(10)

const MessageRow = Schema.Struct({ message: Schema.String })

const notFound = new ConversationNotFound({ message: 'Conversation not found.' })

const conflict = new ConversationConflict({
  message: 'The conversation changed since it was loaded. Reload it and try again.',
})

export interface ConversationTurn {
  /** Stored history up to the new message's parent, followed by the new message. */
  readonly messages: UIMessage[]
  /** Saves the finished conversation, then lets the next turn start. */
  readonly finish: (conversation: UIMessage[]) => Effect.Effect<void, ConversationNotFound>
  /** Lets the next turn start without saving, for a turn that produced no response. */
  readonly release: Effect.Effect<void>
}

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
    /**
     * Starts a chat turn once earlier turns on the conversation finish. The new message
     * replaces everything stored after `parentId`, which covers new, edited, and
     * regenerated messages. Fails with ConversationConflict when the parent is not stored.
     */
    readonly beginTurn: (
      userId: string,
      id: string,
      message: UIMessage,
      parentId: string | null,
    ) => Effect.Effect<ConversationTurn, ConversationNotFound | ConversationConflict, Scope.Scope>
    readonly update: (
      userId: string,
      id: string,
      changes: ConversationChanges,
    ) => Effect.Effect<void, ConversationNotFound>
    readonly remove: (userId: string, id: string) => Effect.Effect<void, ConversationNotFound>
  }
>()('groundwork/ConversationStore') {}

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

// Every lookup is scoped to the user, so another user's conversation reads as not found.
function prepareStatements(db: DatabaseSync) {
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

/** Builds the store on a database. Tests pass a short grace for abandoned turns. */
export function makeConversationStore(
  db: DatabaseSync,
  abandonedTurnGrace: Duration.Input = defaultAbandonedTurnGrace,
) {
  return Effect.gen(function* () {
    const statements = yield* Effect.sync(() => {
      runMigrations(db, migrations)

      return prepareStatements(db)
    })

    const turns = createTurnQueue()
    const decodeSummary = Schema.decodeUnknownSync(ConversationSummary)
    const decodeMessageRow = Schema.decodeUnknownSync(MessageRow)

    const get = (userId: string, id: string) =>
      Effect.flatMap(
        Effect.sync(() => statements.find.get(id, userId)),
        (row) => (row ? Effect.succeed(decodeSummary(row)) : Effect.fail(notFound)),
      )

    const messages = (userId: string, id: string) =>
      Effect.andThen(
        get(userId, id),
        Effect.sync(() =>
          statements.messages.all(id).map((row) => {
            const stored = decodeMessageRow(row).message

            // SAFETY: beginTurn only writes messages that passed validateUIMessages
            // or came from the AI SDK response stream, so each row decodes to a UIMessage.
            return JSON.parse(stored) as UIMessage
          }),
        ),
      )

    const saveMessages = (userId: string, id: string, conversation: UIMessage[]) =>
      Effect.andThen(
        get(userId, id),
        Effect.sync(() => {
          db.exec('BEGIN IMMEDIATE')

          try {
            statements.clearMessages.run(id)

            for (const [position, message] of conversation.entries()) {
              statements.insertMessage.run(id, position, JSON.stringify(message))
            }

            statements.touch.run(new Date().toISOString(), titleFrom(conversation), id, userId)
            db.exec('COMMIT')
          } catch (error) {
            db.exec('ROLLBACK')
            throw error
          }
        }),
      )

    const requireChange = (changes: number | bigint) =>
      changes > 0 ? Effect.void : Effect.fail(notFound)

    return ConversationStore.of({
      create: (userId) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = new Date().toISOString()
          statements.insert.run(id, userId, now, now)

          return id
        }),

      list: (userId) =>
        Effect.sync(() => statements.list.all(userId).map((row) => decodeSummary(row))),

      get,

      messages,

      beginTurn: (userId, id, message, parentId) =>
        Effect.gen(function* () {
          const slot = turns.enter(id)

          // The response normally releases the turn when it is saved. If that never
          // happens, the next turn starts shortly after this request closes.
          yield* Effect.addFinalizer(() =>
            Effect.asVoid(
              Effect.forkDetach(Effect.andThen(Effect.sleep(abandonedTurnGrace), slot.release)),
            ),
          )

          const conversation = yield* Effect.gen(function* () {
            yield* slot.ready

            const stored = yield* messages(userId, id)

            const parentIndex =
              parentId === null ? -1 : stored.findIndex((message) => message.id === parentId)

            if (parentId !== null && parentIndex === -1) return yield* Effect.fail(conflict)

            const next = [...stored.slice(0, parentIndex + 1), message]

            // Save the user's turn before the model runs so it survives a failed response.
            yield* saveMessages(userId, id, next)

            return next
          }).pipe(Effect.onError(() => slot.release))

          return {
            messages: conversation,
            finish: (finished) =>
              Effect.gen(function* () {
                if (yield* slot.isReleased) {
                  return yield* Effect.logWarning(
                    'Skipped saving a response that finished after the next turn started.',
                  )
                }

                yield* saveMessages(userId, id, finished)
              }).pipe(Effect.ensuring(slot.release)),
            release: slot.release,
          }
        }),

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
    })
  })
}

export const ConversationStoreLive = Layer.effect(ConversationStore)(
  Effect.gen(function* () {
    const db = yield* Database

    return yield* makeConversationStore(db)
  }),
)
