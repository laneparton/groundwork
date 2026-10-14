# Local development

Start the backend and frontend together from the repository root:

```sh
./scripts/dev
```

Open http://localhost:5173. Ctrl+C stops both processes. The launcher resolves the repository root, so it also works when called from another directory.

Overmind reads the root `Procfile`. The server loads `apps/server/.env` and uses port 3000 by default. Vite uses port 5173 and exits if that port is occupied, keeping the auth origin and backend proxy consistent. The launcher disables Overmind's automatic `PORT` assignment.

## First-time setup

Use Node.js 24 or newer. Install the process manager and app dependencies:

```sh
brew install overmind tmux
npm ci
npm ci --prefix apps/server
npm ci --prefix apps/web
```

Configure `apps/server/.env` as described in [the server README](../apps/server/README.md), then apply the auth schema:

```sh
(cd apps/server && npm run db:migrate)
```

Stop any separately running backend/frontend before starting the combined stack.

## Process controls

Run these from the repository root in another terminal:

```sh
overmind restart server
overmind restart web
overmind quit
```

The launcher also forwards options, for example `./scripts/dev --help`.
