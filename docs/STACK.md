## Opinionated Technology Stack

1. Frontend: React 19 + Vite SPA
   - Assistant UI
   - ShadCN / Tailwind
   - Playwright for E2E Testing
   - Vitest for Unit Tests
   - Tanstack Query
   - Tanstack Router
   - Oxlint with vendored anti-slop rules; Oxfmt for formatting.
2. Backend: TypeScript
   - Oxlint with vendored anti-slop and Effect rules; Oxfmt for formatting.
   - https://effect.website/
   - Effect HttpApi for the HTTP API. Learning Effect is an explicit goal of this project.
   - AI SDK for agent execution: model interaction, tool calling, the agent loop, and response streaming.
   - Eval Framework: Python DeepEval, managed with uv. Evals sign in through Better Auth and call the same chat endpoint as the web app.
3. Conversations Database
   - SQLite for the demo, behind a storage interface.
   - Application code depends on the interface rather than SQLite. Alternative stores can be plugged in by implementing the same contract.
4. Real Data: https://docs.deps.dev/bigquery/v1/
5. Authentication
   - Sign-in is required. Setup should be easy for developers running the demo.
   - Better Auth for quick, simple authentication setup.

## Proposed Project Structure

One repository with a web app, a backend app, and a small shared API contract package.

```text
groundwork/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/                  # App entry, routing, and providers
│   │       ├── features/
│   │       │   ├── auth/             # Sign-in UI and Better Auth client
│   │       │   └── conversations/    # Conversation list, chat, and tool activity
│   │       ├── components/ui/        # Shared shadcn components
│   │       └── lib/                  # API client and frontend utilities
│   └── server/
│       └── src/
│           ├── main.ts              # Start the HTTP server
│           ├── layers.ts            # Compose concrete Effect service implementations
│           ├── http/                # HttpApi handlers and authentication middleware
│           ├── auth/                # Better Auth configuration and handler
│           ├── agent/               # AI SDK agent, instructions, and tool definitions
│           ├── conversations/
│           │   ├── service.ts       # Conversation operations
│           │   ├── store.ts         # Effect service defining the storage contract
│           │   └── sqlite.ts        # SQLite implementation of that contract
│           ├── data/                # Data access services and deps.dev implementation
│           └── db/                  # Database connection and migrations
├── packages/
│   └── api/
│       └── src/                     # Shared HttpApi definitions and request/response schemas
├── evals/
│   ├── harness/                     # Python auth, stream capture, and DeepEval execution
│   ├── suites/
│   │   ├── conversation/            # Conversation behavior with colocated cases
│   │   └── warehouse/               # Themed warehouse suites with colocated cases
│   ├── tests/harness/               # Offline tests of the eval harness
│   └── pyproject.toml               # Python dependencies managed with uv
├── scripts/                         # Local setup and data preparation
├── .env.example
├── MISSION.md
└── STACK.md
```

- HTTP handlers call application services. Agent tools call data services. Neither accesses SQLite directly.
- `layers.ts` supplies the implementations. Replacing conversation storage means implementing `store.ts` and changing the supplied layer.
- The shared API package contains public contracts, without server implementations or credentials.
- Evals exercise the same agent and tools used by the application. Keep ordinary tests beside the code they test.
- Start with these boundaries; add folders as code needs them. Runtime, package manager, and workspace tooling remain open decisions.
