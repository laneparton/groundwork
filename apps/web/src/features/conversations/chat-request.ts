import type { PrepareSendMessagesRequest, UIMessage } from 'ai'

// The server stores each conversation, so a chat request carries only the new user
// message and the id of the message it follows. The same shape covers new, edited,
// and regenerated messages: the server replaces whatever it stored after the parent.
export const prepareSendMessagesRequest: PrepareSendMessagesRequest<UIMessage> = ({
  id,
  messages,
}) => ({
  body: {
    id,
    message: messages.at(-1),
    parentId: messages.at(-2)?.id ?? null,
  },
})
