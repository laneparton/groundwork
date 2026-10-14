import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { LogOutIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/features/auth/client'
import { cn } from '@/lib/utils'

export function SidebarAccount({ collapsed = false }: { collapsed?: boolean }) {
  const { data } = authClient.useSession()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const name = data?.user.name ?? 'Account'

  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

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
    <div className="shrink-0 border-t p-2">
      <Menu.Root>
        <Menu.Trigger
          render={<Button variant="ghost" />}
          aria-label={`Account: ${name}`}
          className={cn(
            'h-auto w-full gap-2 rounded-lg',
            collapsed ? 'justify-center p-0' : 'justify-start p-1.5',
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {initials}
          </span>
          {!collapsed && (
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {data?.user.email}
              </span>
            </span>
          )}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
            <Menu.Popup className="min-w-48 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
              <Menu.Item
                disabled={signingOut}
                onClick={signOut}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50"
              >
                <LogOutIcon className="size-4" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
