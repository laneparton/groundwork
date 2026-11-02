# Groundwork server

Effect HttpApi server for sign-in and the streaming chat agent. Install dependencies as described in [the root README](../../README.md), then:

```sh
cp .env.example .env   # fill in the values below
npm run db:migrate     # first run, and after Better Auth schema changes
npm run dev            # http://127.0.0.1:3000
```

## Configuration

Node loads `.env` at startup; restart after changing it. Invalid values stop the server at startup.

| Variable                    | Default                                       | Notes                                                       |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `OPENAI_API_KEY`            |                                               | Chat returns `503` until this and `CHAT_MODEL` are set.     |
| `CHAT_MODEL`                |                                               | OpenAI model ID.                                            |
| `BETTER_AUTH_SECRET`        |                                               | Required. At least 32 characters: `openssl rand -hex 32`.   |
| `BETTER_AUTH_URL`           | `http://localhost:3000`                       |                                                             |
| `AUTH_TRUSTED_ORIGINS`      | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated frontend origins.                           |
| `AUTH_DATABASE_PATH`        | `.data/auth.sqlite`                           |                                                             |
| `BIGQUERY_PROJECT_ID`       |                                               | Project that runs query jobs. Without it, SQL calls fail.   |
| `BIGQUERY_DATASET`          | `bigquery-public-data.deps_dev_v1`            | Any other `project.dataset` restricts queries to that copy. |
| `BIGQUERY_MAX_BYTES_BILLED` | `20000000000`                                 | Per-query cap.                                              |
| `HOST` / `PORT`             | `127.0.0.1` / `3000`                          |                                                             |

BigQuery uses [Application Default Credentials](https://cloud.google.com/docs/authentication/provide-credentials-adc) (`gcloud auth application-default login`). The identity needs BigQuery Job User on `BIGQUERY_PROJECT_ID`.

## Endpoints

- `GET /health`: liveness.
- `/api/auth/*`: Better Auth email/password sign-up, sign-in, session, and sign-out.
- `POST /chat`: requires a session. Accepts AI SDK UI messages and streams the agent's response as AI SDK UI-message SSE. Returns `401` without a session, `400` for invalid messages, and `503` when chat is not configured.

## The `query_sql` tool

The agent's one tool runs a single GoogleSQL `SELECT` against `BIGQUERY_DATASET`. A dry run rejects other statements before anything is billed. Results are capped at 100 rows with a `truncated` flag, and each job times out after 30 seconds. Query errors return to the model as tool output. Stopping or disconnecting cancels the running job.

## Scripts

```sh
npm run typecheck
npm run lint
npm test         # unit tests; the cross-app integration test runs from ../web
npm run build    # emits dist/
npm start        # runs dist/
```

`scripts/*-data-pilot.ts` plan, create, and validate a bounded BigQuery copy of deps.dev for `BIGQUERY_DATASET`.
