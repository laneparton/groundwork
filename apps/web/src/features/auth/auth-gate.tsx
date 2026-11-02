import type { ReactNode } from 'react'
import { Navigate } from '@tanstack/react-router'
import { authClient } from './client'
import { SessionLoading } from './session-loading'

export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isPending, error } = authClient.useSession()

  if (isPending) return <SessionLoading />

  if (error)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Unable to load your session. Check the server connection and reload.
      </p>
    )

  if (!data) return <Navigate to="/sign-in" />

  return children
}
