# Groundwork server

Node.js backend using Effect v4, Effect HttpApi, AI SDK v7, Better Auth, SQLite, TypeScript, and Oxlint.

## Run locally

Use Node.js 24 or newer and npm. From the repository root:

```sh
npm ci
cd apps/server
npm ci
cp .env.example .env
```

Set `OPENAI_API_KEY` and `CHAT_MODEL` in `.env` to your OpenAI API key and model ID. Generate a local auth secret with `openssl rand -hex 32` and put it in `BETTER_AUTH_SECRET`. Then run:

```sh
npm run db:migrate
npm run dev
```

The server listens at `http://127.0.0.1:3000`. `HOST` and `PORT` are optional. The key stays on the backend. Node loads `.env`; Effect Config validates the settings. Restart the server after changing `.env`.

## Endpoints

- `GET /health`: returns `200` with `{"status":"ok"}`.
- `/api/auth/*`: Better Auth sign-up, sign-in, session, and sign-out endpoints.
- `POST /chat`: requires a valid session cookie, accepts AI SDK UI messages and streams the assistant response using the AI SDK UI-message SSE protocol.

```sh
curl http://127.0.0.1:3000/health

# Use the session cookie from signing in, or use the web UI.
curl -N http://127.0.0.1:3000/chat \
  -H 'Cookie: better-auth.session_token=<session cookie>' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"user-1","role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

Unauthenticated chat requests return `401`. Invalid messages return `400`. Missing chat configuration returns `503`; health still works. Provider failures after streaming starts are sent as stream errors. Client cancellation aborts the provider request through the Effect request scope.

## File map

```text
src/
├── main.ts                 # Runtime entry point and shutdown
├── config.ts               # Server and model configuration
├── layers.ts               # HTTP and Node server composition
├── auth/
│   ├── session.ts         # Require a signed-in session
│   ├── service.ts         # Better Auth and scoped SQLite connection
│   └── migrate.ts         # Apply Better Auth schema migrations
├── chat/
│   ├── model.ts           # Model configuration
│   └── stream-response.ts # AI SDK stream and cancellation lifecycle
└── http/
    ├── api.ts              # Contracts and schemas
    ├── auth.ts             # Forward auth requests and response cookies
    ├── errors.ts           # Schema-backed HTTP errors
    ├── health.ts           # Liveness handler
    └── chat.ts             # Validation, configuration, streaming response
```

HttpApi validates the request envelope; AI SDK validates the individual UI messages. The handler converts the SDK's Web Response into an Effect HTTP response, preserving its body stream and headers.

The local Effect guides are at `../../temp/docs/effect`; provenance is recorded in `../../temp/docs/effect-source.md`.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
npm start
```

The build emits JavaScript and source maps into `dist`. Start runs the compiled output. The cross-app streaming integration test runs from `../web` with `npm test`. It uses local provider fixtures, never real credentials or paid model calls.

## Authentication storage

Email/password sign-in uses Better Auth with Node's built-in SQLite driver. Users, password hashes, and sessions are stored at `.data/auth.sqlite` by default. The path can be changed with `AUTH_DATABASE_PATH`. Database files and `.env` are ignored by Git.

Run `npm run db:migrate` on first setup and after changing the auth schema. Migration uses the same configuration as the server. The server does not run schema migrations automatically.

`BETTER_AUTH_URL` defaults to `http://localhost:3000`. `AUTH_TRUSTED_ORIGINS` is a comma-separated list of allowed frontend origins, defaulting to `http://localhost:5173,http://127.0.0.1:5173`. Set both explicitly when hosting the app elsewhere. The development frontend proxies auth requests to the backend and uses same-origin cookies.

Email verification and password reset delivery are not configured in this initial demo. Better Auth handles password hashing and session cookies; chat checks the session on every request.

Conversation persistence and evals remain future work. The basic chat sends the current conversation to the model on each request and keeps no server-side state.

Formatting and anti-slop lint rules use the root tooling installation. See [the root README](../../README.md) for `npm run format`, `npm run format:check`, and `npm run lint`.

## SQL tool

Chat uses a vanilla AI SDK `streamText` loop with one server-side tool, `query_sql`.
The model can query the [deps.dev public dataset](https://docs.deps.dev/bigquery/v1/)
and then use its results in the streamed answer. The existing assistant-ui tool
renderer shows the SQL input, result, and errors.

Set `BIGQUERY_PROJECT_ID` in `.env` to the Google Cloud project that will run the
query jobs. Enable the BigQuery API on that project and configure
[Application Default Credentials](https://cloud.google.com/docs/authentication/provide-credentials-adc):

```sh
gcloud auth application-default login
```

The identity needs permission to create BigQuery jobs in that project, such as
BigQuery Job User. The deps.dev dataset is public. Use read-only dataset access
if you give this identity access to other datasets.

Example prompt: "What licenses does react 19.2.0 declare on npm?"

The tool accepts a single GoogleSQL SELECT/WITH query. A BigQuery dry run checks
that it is a SELECT before execution. Results are capped at 100 rows, with a
`truncated` flag. Each query has a 30-second job timeout and a default maximum
of 20,000,000,000 bytes billed; change `BIGQUERY_MAX_BYTES_BILLED` in `.env` if
needed. Pressing Stop or disconnecting the request also cancels its query job.

The initial instructions include a small schema summary and point the model to
INFORMATION_SCHEMA for discovery. These are starter instructions, not an agent
harness. Code lives in `src/agent/tools.ts`, `src/agent/instructions.ts`, and
`src/data/bigquery.ts`.

Without BigQuery configuration, ordinary chat still works and SQL calls report
an error. The integration test uses a local BigQuery HTTP fixture to verify the
tool call, result, model follow-up, and query-job cancellation without cloud
credentials or billed queries.
