# Groundwork web app

React SPA for sign-in and chat, built with Vite, TanStack Router, assistant-ui, and Tailwind. Install dependencies as described in [the root README](../../README.md), then:

```sh
npm run dev   # http://localhost:5173
```

In development, Vite proxies `/api/auth`, `/chat`, and `/health` to the server at `http://127.0.0.1:3000`. Production hosting must route those paths to the server and fall back to `index.html` for client-side routes.

## Structure

- `src/routes/`: file-based routes. The router plugin generates `src/routeTree.gen.ts`; do not edit it.
- `src/features/auth/`: Better Auth client, sign-in form, and session gate.
- `src/features/conversations/`: conversation layout and the assistant-ui runtime connected to `/chat`.
- `src/components/assistant-ui/`: thread and conversation-list components built from assistant-ui primitives.
- `src/components/ui/`: shadcn components on Base UI.

## Scripts

```sh
npm run typecheck
npm run lint
npm test         # integration test against the real server
npm run build
npm run preview  # serves the production build
```

`npm test` starts the server with a temporary SQLite database and local OpenAI and BigQuery fixtures. It covers sign-up, sign-in, and sign-out, streamed chat, the SQL tool round trip, invalid messages, and cancellation of both the model request and the query job. It needs the server dependencies installed and never calls paid APIs.
