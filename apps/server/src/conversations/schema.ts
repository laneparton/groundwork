import { Schema } from 'effect'

// One definition for stored rows and the HTTP contract.
export const ConversationStatus = Schema.Literals(['regular', 'archived'])

export const ConversationSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  status: ConversationStatus,
  updatedAt: Schema.String,
})

export type ConversationSummary = typeof ConversationSummary.Type

export const ConversationChanges = Schema.Struct({
  title: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  status: Schema.optional(ConversationStatus),
})

export type ConversationChanges = typeof ConversationChanges.Type

export class ConversationNotFound extends Schema.TaggedError<ConversationNotFound>()(
  'ConversationNotFound',
  { message: Schema.String },
) {}

export class ConversationConflict extends Schema.TaggedError<ConversationConflict>()(
  'ConversationConflict',
  { message: Schema.String },
) {}
