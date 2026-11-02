# Groundwork

An opinionated reference implementation for an AI agent web application. See [the mission](docs/MISSION.md) and [stack decisions](docs/STACK.md).

## Local setup

Use Node.js 24 or newer. Install root tooling and both app dependencies:

```sh
npm ci
npm ci --prefix apps/server
npm ci --prefix apps/web
```

Configure `apps/server/.env` and run the auth migration as described in [the server README](apps/server/README.md). Start both apps with `./scripts/dev` ([launcher notes](scripts/README.md)).

## Formatting and linting

From the repository root:

```sh
npm run format
npm run format:check
npm run lint
```

Oxfmt uses one shared configuration: two-space indentation, single quotes, no semicolons, and a 100-column target. The formatter covers application source and configuration. It leaves generated route trees, lockfiles, docs, and vendored rules alone.

Anti-slop rules are vendored in `tools/oxlint/anti-slop`. Generic rules apply to both apps; Effect-specific rules apply to the server. Readable spacing is enforced by lint, so after adding code you may need:

```sh
npm run lint --prefix apps/server -- --fix
npm run lint --prefix apps/web -- --fix
npm run format
```

The plugin and Oxlint versions are pinned together. [UPSTREAM.md](tools/oxlint/anti-slop/UPSTREAM.md) records provenance and the configured scope.

## Verification

```sh
npm run build --prefix apps/server
npm run build --prefix apps/web
npm test --prefix apps/server
npm test --prefix apps/web
```

The web test is the cross-app integration test. It uses local fixtures and never calls paid APIs.
