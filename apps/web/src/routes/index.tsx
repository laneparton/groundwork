import { createFileRoute } from '@tanstack/react-router'
import { ProtectedChat } from '@/features/conversations/conversation-page'

export const Route = createFileRoute('/')({ component: ProtectedChat })
