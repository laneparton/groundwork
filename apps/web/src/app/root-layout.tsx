import { Link, Outlet } from '@tanstack/react-router'

export function RootLayout() {
  return <Outlet />
}

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-content-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="underline underline-offset-4">Return to Groundwork</Link>
    </main>
  )
}
