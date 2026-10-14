import { ThreadListItemPrimitive, ThreadListPrimitive } from '@assistant-ui/react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThreadList() {
  return (
    <ThreadListPrimitive.Root className="flex flex-col gap-2">
      <ThreadListPrimitive.New asChild>
        <Button variant="outline" className="justify-start">
          <PlusIcon aria-hidden="true" />
          New conversation
        </Button>
      </ThreadListPrimitive.New>
      <ThreadListPrimitive.Items>
        {() => (
          <ThreadListItemPrimitive.Root className="rounded-lg hover:bg-muted data-active:bg-muted">
            <ThreadListItemPrimitive.Trigger className="w-full truncate rounded-lg px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <ThreadListItemPrimitive.Title fallback="Untitled conversation" />
            </ThreadListItemPrimitive.Trigger>
          </ThreadListItemPrimitive.Root>
        )}
      </ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  )
}
