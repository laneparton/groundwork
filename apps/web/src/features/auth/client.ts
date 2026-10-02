import { createAuthClient } from 'better-auth/react'

// Same-origin requests go through the Vite proxy during development.
export const authClient = createAuthClient()
