import type { RemoteThreadListAdapter } from '@assistant-ui/react'
import { createAssistantStream } from 'assistant-stream'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
  type ConversationSummary,
} from './api'
import { ConversationHistoryProvider } from './conversation-history'

function toThreadMetadata(conversation: ConversationSummary) {
  return {
    status: conversation.status,
    remoteId: conversation.id,
    title: conversation.title ?? undefined,
    lastMessageAt: new Date(conversation.updatedAt),
  }
}

export const conversationListAdapter: RemoteThreadListAdapter = {
  list: async () => ({ threads: (await listConversations()).map(toThreadMetadata) }),
  initialize: async () => ({ remoteId: await createConversation() }),
  rename: (remoteId, title) => updateConversation(remoteId, { title }),
  archive: (remoteId) => updateConversation(remoteId, { status: 'archived' }),
  unarchive: (remoteId) => updateConversation(remoteId, { status: 'regular' }),
  delete: deleteConversation,
  fetch: async (remoteId) => toThreadMetadata(await getConversation(remoteId)),
  // The server titles a conversation from its first user message.
  generateTitle: async (remoteId) => {
    const { title } = await getConversation(remoteId)

    return createAssistantStream((controller) => {
      if (title) controller.appendText(title)
    })
  },
  unstable_Provider: ConversationHistoryProvider,
}
