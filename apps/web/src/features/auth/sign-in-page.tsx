import { useState, type FormEvent } from 'react'
import { Navigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authClient } from './client'

const inputClass = 'mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function SignInPage() {
  const { data, isPending } = authClient.useSession()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signingUp = mode === 'sign-up'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = signingUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password })
      if (result.error) setError(result.error.message ?? 'Unable to sign in.')
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (isPending) return <p role="status" className="p-6 text-sm text-muted-foreground">Loading session…</p>
  if (data) return <Navigate to="/" />

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 p-6">
      <section className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Groundwork</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{signingUp ? 'Create an account' : 'Sign in'}</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {signingUp && <label className="block text-sm font-medium">Name<input name="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>}
          <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></label>
          <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}</Button>
        </form>
        <Button variant="link" disabled={busy} className="mt-3 w-full" onClick={() => {
          setMode(signingUp ? 'sign-in' : 'sign-up')
          setPassword('')
          setError('')
        }}>{signingUp ? 'Already have an account? Sign in' : 'Create an account'}</Button>
      </section>
    </main>
  )
}
