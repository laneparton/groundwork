# Groundwork web app

React 19 and TypeScript SPA built with Vite, TanStack Router, Tailwind CSS, and Oxlint.

## Run locally

Use Node.js 24 or newer and npm. From the repository root:

```sh
npm ci
cd apps/web
npm ci
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173).

## Checks

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

The build generates the route tree, builds the production SPA, and checks TypeScript. `npm run preview` serves the production build locally. Production hosting must fall back to `index.html` for client-side routes.

## Structure

- `src/app/`: router setup and root layout.
- `src/routes/`: file-based routes; the Vite plugin generates `src/routeTree.gen.ts`. Do not edit the generated file manually.
- `src/features/auth/`: Better Auth client, sign-in/sign-up form, and session gate.
- `src/features/conversations/`: conversation page and assistant-ui AI SDK runtime.
- `src/components/assistant-ui/`: application-owned thread, composer, message, and conversation-list components built from assistant-ui primitives.
- `src/components/ui/`: shadcn components, currently using Base UI.
- `src/index.css`: Tailwind and theme tokens.

## Chat connection

Start `apps/server` in another terminal and configure its `.env` with `OPENAI_API_KEY` and `CHAT_MODEL` (see the server README). Run the server auth migration before first use. Vite proxies `/api/auth`, `/chat`, and `/health` to `http://127.0.0.1:3000`.

`src/features/conversations/chat-runtime.tsx` uses assistant-ui's `useChatRuntime` and `AssistantChatTransport`. The backend calls AI SDK `streamText` and returns a UI-message stream. The UI sends the current conversation history; messages reset on reload.

Create an account or sign in at `/sign-in` to access chat. Sign-out unmounts the chat runtime and clears in-memory conversations. Conversation persistence and data tools are not implemented yet. Production hosting must also route `/api/auth/*` and `/chat` to the backend; the proxy here is for development.

`npm test` checks the actual assistant-ui transport against the Effect endpoint with a local OpenAI protocol fixture, including SQLite-backed sign-up/sign-in, unauthorized access, sign-out revocation, incremental text, invalid messages, and cancellation. It requires the server dependencies to be installed and uses Node's test runner.

The assistant-ui documentation snapshot is at `../../temp/docs/assistant-ui`; its source commit is recorded in `../../temp/docs/assistant-ui-source.md`.

## UI ownership

assistant-ui supplies runtime state and headless primitives. This app supplies layout, styles, and UI composition. The optional registry templates are not used by the current chat components. The style-aware registry remains configured in `components.json` for adding components later.

Formatting and the shared anti-slop plugin utilities use the root tooling installation. Each app installs and runs its own Oxlint binary. See [the root README](../../README.md) for `npm run format`, `npm run format:check`, and `npm run lint`.
