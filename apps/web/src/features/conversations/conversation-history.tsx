import { useMemo, type ReactNode } from 'react'
import {
  RuntimeAdapterProvider,
  useAui,
  type MessageFormatAdapter,
  type ThreadHistoryAdapter,
} from '@assistant-ui/react'
import type { UIMessage } from 'ai'
import { getConversation } from './api'

// The server saves every chat request and the finished response, so the client
// only reads history. Writes from the runtime are intentionally no-ops.
const aiSdkFormat = 'ai-sdk/v6'

type StoredUIMessage = Omit<UIMessage, 'id'>

function useServerHistory() {
  const aui = useAui()

  return useMemo<ThreadHistoryAdapter>(() => {
    const withFormat = (formatAdapter: MessageFormatAdapter<UIMessage, StoredUIMessage>) => {
      if (formatAdapter.format !== aiSdkFormat) {
        throw new Error(`Conversation history only supports the ${aiSdkFormat} format.`)
      }

      return {
        load: async () => {
          const remoteId = aui.threadListItem.getState().remoteId

          if (!remoteId) return { messages: [] }

          const { messages } = await getConversation(remoteId)

          return {
            messages: messages.map(({ id, ...content }, index) =>
              formatAdapter.decode({
                id,
                parent_id: messages[index - 1]?.id ?? null,
                format: aiSdkFormat,
                content,
              }),
            ),
          }
        },
        append: async () => {},
      }
    }

    return {
      load: async () => ({ messages: [] }),
      append: async () => {},
      // SAFETY: the AI SDK runtime only calls withFormat with its ai-sdk/v6 adapter,
      // which stores UIMessages without their id; withFormat rejects any other format.
      withFormat: withFormat as ThreadHistoryAdapter['withFormat'],
    }
  }, [aui])
}

export function ConversationHistoryProvider({ children }: { children?: ReactNode }) {
  const history = useServerHistory()
  const adapters = useMemo(() => ({ history }), [history])

  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>
}
