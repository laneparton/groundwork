import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react'
import { ArrowUpIcon, CopyIcon, PencilIcon, RefreshCwIcon, SquareIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 md:px-8">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="m-auto max-w-xl py-12 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">Start a conversation</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Ask a question to get started.
            </p>
          </div>
        </AuiIf>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <ThreadPrimitive.Messages>
            {({ message }) => <Message role={message.role} editing={message.composer.isEditing} />}
          </ThreadPrimitive.Messages>
        </div>
      </ThreadPrimitive.Viewport>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 pb-5">
        <Composer />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Messages reset when you reload.
        </p>
      </div>
    </ThreadPrimitive.Root>
  )
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="rounded-xl border bg-background p-3 focus-within:ring-2 focus-within:ring-ring">
      <ComposerPrimitive.Input
        aria-label="Message"
        placeholder="Ask a question…"
        rows={2}
        className="max-h-40 min-h-12 w-full resize-none bg-transparent text-sm outline-none"
      />
      <div className="flex justify-end">
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <Button aria-label="Send message" size="icon">
              <ArrowUpIcon aria-hidden="true" />
            </Button>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button aria-label="Stop response" size="icon">
              <SquareIcon aria-hidden="true" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </ComposerPrimitive.Root>
  )
}

function Message({ role, editing }: { role: string; editing: boolean }) {
  const user = role === 'user'

  return (
    <MessagePrimitive.Root className={`flex flex-col gap-2 ${user ? 'items-end' : 'items-start'}`}>
      <span className="text-xs font-medium text-muted-foreground">
        {user ? 'You' : 'Groundwork'}
      </span>
      {editing ? (
        <ComposerPrimitive.Root className="w-full rounded-xl border p-3">
          <ComposerPrimitive.Input
            aria-label="Edit message"
            className="min-h-20 w-full resize-none text-sm outline-none"
          />
          <div className="flex justify-end gap-2">
            <ComposerPrimitive.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send asChild>
              <Button>Save and resend</Button>
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      ) : (
        <div
          className={`max-w-full rounded-xl px-4 py-3 text-sm leading-6 wrap-break-word ${user ? 'bg-muted' : 'w-full'}`}
        >
          <MessagePrimitive.Parts />
          <MessagePrimitive.Error>
            <ErrorPrimitive.Root className="mt-2 text-destructive">
              <ErrorPrimitive.Message />
            </ErrorPrimitive.Root>
          </MessagePrimitive.Error>
        </div>
      )}
      <ActionBarPrimitive.Root hideWhenRunning className="flex gap-1">
        {user ? (
          <ActionBarPrimitive.Edit asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Edit message">
              <PencilIcon aria-hidden="true" />
            </Button>
          </ActionBarPrimitive.Edit>
        ) : (
          <>
            <ActionBarPrimitive.Copy asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Copy response">
                <CopyIcon aria-hidden="true" />
              </Button>
            </ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Regenerate response">
                <RefreshCwIcon aria-hidden="true" />
              </Button>
            </ActionBarPrimitive.Reload>
          </>
        )}
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  )
}
