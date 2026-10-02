import { Thread } from '@/components/assistant-ui/thread'
import { ThreadList } from '@/components/assistant-ui/thread-list'
import { ChatRuntimeProvider } from './chat-runtime'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/features/auth/client'
import { AuthGate } from '@/features/auth/auth-gate'

export function ProtectedChat() {
  return <AuthGate><ConversationPage /></AuthGate>
}

export function ConversationPage() {
  const { data } = authClient.useSession()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    setSigningOut(true)
    setError('')
    try {
      const result = await authClient.signOut()
      if (result.error) setError(result.error.message ?? 'Unable to sign out.')
    } catch {
      setError('Unable to sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <ChatRuntimeProvider>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Groundwork</h1>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:block">{data?.user.name}</span>
            <Button variant="outline" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
          </div>
        </header>
        {error && <p role="alert" className="px-5 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside aria-label="Conversations" className="max-h-44 shrink-0 overflow-y-auto border-b bg-muted/30 p-3 md:max-h-none md:w-64 md:border-r md:border-b-0">
            <ThreadList />
          </aside>
          <main aria-label="Chat" className="min-h-0 min-w-0 flex-1">
            <Thread />
          </main>
        </div>
      </div>
    </ChatRuntimeProvider>
  )
}
