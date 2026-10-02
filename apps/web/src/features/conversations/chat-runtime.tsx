import type { ReactNode } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk'

const transport = new AssistantChatTransport({ api: '/chat' })

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useChatRuntime({ transport })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
