import type { ReactNode } from 'react'
import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from '@assistant-ui/react'
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk'
import { prepareSendMessagesRequest } from './chat-request'
import { conversationListAdapter } from './conversation-adapter'

const transport = new AssistantChatTransport({ api: '/chat', prepareSendMessagesRequest })

function useChatThreadRuntime() {
  return useChatRuntime({ transport })
}

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatThreadRuntime,
    adapter: conversationListAdapter,
  })

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
