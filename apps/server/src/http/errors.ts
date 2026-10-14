import { Schema } from 'effect'

export class InvalidChatRequest extends Schema.TaggedError<InvalidChatRequest>()(
  'InvalidChatRequest',
  { message: Schema.String },
) {}

export class ChatUnavailable extends Schema.TaggedError<ChatUnavailable>()('ChatUnavailable', {
  message: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String,
}) {}
