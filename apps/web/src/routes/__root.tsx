import { createRootRoute } from '@tanstack/react-router'
import { NotFound, RootLayout } from '@/app/root-layout'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
})
