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
// Messages form a tree: each points at the message it follows, so edits and
// regenerations add siblings instead of replacing history. `headId` marks the leaf of
// the branch written last. Append new migrations; never edit one that has shipped.
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
  {
    name: 'conversations-002-message-tree',
    // Linear conversations become a single branch: each message's parent is the one
    // before it, and the head is the last message.
    sql: `
      ALTER TABLE conversation ADD COLUMN headId TEXT;
      ALTER TABLE conversation_message RENAME TO conversation_message_linear;
      CREATE TABLE conversation_message (
        conversationId TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        parentId TEXT,
        message TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (conversationId, id),
        FOREIGN KEY (conversationId, parentId) REFERENCES conversation_message (conversationId, id)
      );
      CREATE INDEX conversation_message_parent ON conversation_message (conversationId, parentId);
      INSERT INTO conversation_message (conversationId, id, parentId, message, createdAt)
        SELECT
          linear.conversationId,
          json_extract(linear.message, '$.id'),
          LAG(json_extract(linear.message, '$.id'))
            OVER (PARTITION BY linear.conversationId ORDER BY linear.position),
          linear.message,
          conversation.createdAt
        FROM conversation_message_linear AS linear
        JOIN conversation ON conversation.id = linear.conversationId
        ORDER BY linear.conversationId, linear.position;
      UPDATE conversation SET headId = (
        SELECT json_extract(message, '$.id') FROM conversation_message_linear
        WHERE conversationId = conversation.id ORDER BY position DESC LIMIT 1
      );
      DROP TABLE conversation_message_linear;
    `,
  },
]

const titleLength = 60

// How long after its request closes a turn still waits for its response to be saved.
const defaultAbandonedTurnGrace = Duration.seconds(10)

const MessageRow = Schema.Struct({ message: Schema.String })
const NodeRow = Schema.Struct({ parentId: Schema.NullOr(Schema.String) })
const TreeRow = Schema.Struct({ parentId: Schema.NullOr(Schema.String), message: Schema.String })
const HeadRow = Schema.Struct({ headId: Schema.NullOr(Schema.String) })

const notFound = new ConversationNotFound({ message: 'Conversation not found.' })

const conflict = new ConversationConflict({
  message: 'The conversation changed since it was loaded. Reload it and try again.',
})

export interface ConversationTree {
  /** The leaf of the branch written last, or null for an empty conversation. */
  readonly headId: string | null
  /** Every stored message, parents before children. */
  readonly messages: ReadonlyArray<{ message: UIMessage; parentId: string | null }>
}

export interface ConversationTurn {
  /** The branch from the first message to the new one: what the model sees. */
  readonly messages: UIMessage[]
  /** Stores the response messages that follow the turn, then lets the next turn start. */
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
    ) => Effect.Effect<ConversationTree, ConversationNotFound>
    /**
     * Starts a chat turn once earlier turns on the conversation finish. A new message id
     * under `parentId` adds a branch (a new or edited message); a stored message under
     * the same parent is reused (a regenerated response). Fails with ConversationConflict
     * when the parent is not stored or the message id is stored under another parent.
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

// Every conversation lookup is scoped to the user, so another user's conversation
// reads as not found. Message statements run only after that check.
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
    head: db.prepare('SELECT headId FROM conversation WHERE id = ?'),
    tree: db.prepare(
      'SELECT parentId, message FROM conversation_message WHERE conversationId = ? ORDER BY createdAt, rowid',
    ),
    node: db.prepare(
      'SELECT parentId FROM conversation_message WHERE conversationId = ? AND id = ?',
    ),
    branch: db.prepare(`
      WITH RECURSIVE branch (id, parentId, message, depth) AS (
        SELECT id, parentId, message, 0 FROM conversation_message
        WHERE conversationId = :conversationId AND id = :leafId
        UNION ALL
        SELECT parent.id, parent.parentId, parent.message, branch.depth + 1
        FROM conversation_message AS parent
        JOIN branch ON parent.conversationId = :conversationId AND parent.id = branch.parentId
      )
      SELECT message FROM branch ORDER BY depth DESC
    `),
    insertMessage: db.prepare(
      'INSERT INTO conversation_message (conversationId, id, parentId, message, createdAt) VALUES (?, ?, ?, ?, ?)',
    ),
    moveHead: db.prepare(
      'UPDATE conversation SET headId = ?, updatedAt = ?, title = COALESCE(title, ?) WHERE id = ?',
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
    const decodeNodeRow = Schema.decodeUnknownSync(NodeRow)
    const decodeTreeRow = Schema.decodeUnknownSync(TreeRow)
    const decodeHeadRow = Schema.decodeUnknownSync(HeadRow)

    // SAFETY: beginTurn and finish only write messages that passed validateUIMessages
    // or came from the AI SDK response stream, so each stored row decodes to a UIMessage.
    const parseMessage = (stored: string) => JSON.parse(stored) as UIMessage

    const get = (userId: string, id: string) =>
      Effect.flatMap(
        Effect.sync(() => statements.find.get(id, userId)),
        (row) => (row ? Effect.succeed(decodeSummary(row)) : Effect.fail(notFound)),
      )

    const branchTo = (conversationId: string, leafId: string) =>
      statements.branch
        .all({ conversationId, leafId })
        .map((row) => parseMessage(decodeMessageRow(row).message))

    const parentOf = (conversationId: string, messageId: string) => {
      const row = statements.node.get(conversationId, messageId)

      return row ? decodeNodeRow(row).parentId : undefined
    }

    // Appends messages as a chain under `parentId`, then moves the head to `headId`
    // unless it is null. The first user message on the head's branch titles an untitled
    // conversation.
    const appendBranch = (
      conversationId: string,
      parentId: string | null,
      messages: UIMessage[],
      headId: string | null,
    ) => {
      db.exec('BEGIN IMMEDIATE')

      try {
        const now = new Date().toISOString()
        let parent = parentId

        for (const message of messages) {
          statements.insertMessage.run(
            conversationId,
            message.id,
            parent,
            JSON.stringify(message),
            now,
          )
          parent = message.id
        }

        if (headId !== null) {
          const title = titleFrom(branchTo(conversationId, headId))
          statements.moveHead.run(headId, now, title, conversationId)
        }

        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }

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

      messages: (userId, id) =>
        Effect.andThen(
          get(userId, id),
          Effect.sync(() => ({
            headId: decodeHeadRow(statements.head.get(id)).headId,
            messages: statements.tree.all(id).map((row) => {
              const { parentId, message } = decodeTreeRow(row)

              return { message: parseMessage(message), parentId }
            }),
          })),
        ),

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

          const branch = yield* Effect.gen(function* () {
            yield* slot.ready
            yield* get(userId, id)

            if (parentId !== null && parentOf(id, parentId) === undefined) {
              return yield* conflict
            }

            const storedParent = parentOf(id, message.id)

            if (storedParent !== undefined && storedParent !== parentId) {
              return yield* conflict
            }

            // Save the user's turn before the model runs so it survives a failed response.
            // A regenerated message is already stored; only the head moves.
            const added = storedParent === undefined ? [message] : []
            yield* Effect.sync(() => appendBranch(id, parentId, added, message.id))

            return yield* Effect.sync(() => branchTo(id, message.id))
          }).pipe(Effect.onError(() => slot.release))

          return {
            messages: branch,
            finish: (conversation) =>
              Effect.gen(function* () {
                yield* get(userId, id)

                // A response that finishes after the next turn started is kept as its
                // own branch but does not take the head from the newer turn.
                const isCurrent = !(yield* slot.isReleased)

                const response = conversation
                  .slice(branch.length)
                  .filter((reply) => reply.parts.length > 0)

                const headId = isCurrent ? (response.at(-1)?.id ?? null) : null

                yield* Effect.sync(() => appendBranch(id, message.id, response, headId))
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
