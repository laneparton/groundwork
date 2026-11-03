# Repository guidance

- Use the root Oxfmt configuration. Run `npm run format` and `npm run format:check` after editing application code.
- Run `npm run lint` from the root to check both applications, including the vendored anti-slop rules.
- Keep Effect handlers focused on the request flow. Put session checks, model configuration, and streaming lifecycle details in their owning modules.
- Preserve request cancellation when changing streamed responses. `npm run test:integration --prefix apps/web` is the cross-app test for auth, streaming, and cancellation over a real socket.
- Keep the vendored rules unchanged during application cleanup. Record intentional rule changes and upstream updates in `tools/oxlint/anti-slop/UPSTREAM.md`.
- Do not format downloaded docs, generated route trees, lockfiles, or vendored rules.
- Write commit messages in Conventional Commits format, such as `feat(web): add chat history`. Commitlint enforces this, and the pre-commit hook formats and lints staged files. Do not bypass the hooks with `--no-verify`.

## Testing

- Unit tests use Vitest beside the code (`src/**/*.test.ts`). Run `npm test` or `npm run test:coverage` in `apps/server` and `apps/web`. Coverage must stay at or above 80% for lines, branches, functions, and statements.
- Server tests use `@effect/vitest` (`it.effect`, `TestClock`) and provide fakes as layers. Module mocking is banned by lint: give a dependency a seam instead, such as a `make*` constructor that takes the client or model (`makeWarehouse`, `makeAgent`, `makeConversationStore`), and keep the live layer as thin wiring.
- Web unit tests cover plain TypeScript modules only, with `fetch` stubbed. React behavior is tested end to end: `npm run test:e2e --prefix apps/web` runs Playwright against the real server, Vite, and a fake model provider (`e2e/fake-openai.ts`) on separate ports.
- `npm run test:mutation` runs Stryker. CI fails below the `break` score in each app's `stryker.config.json`; raise it as tests improve, never lower it to pass.
- Pre-commit formats, lints, typechecks, and runs the unit tests related to staged files. Pre-push runs both coverage gates and the e2e suite. CI runs all of that plus mutation and integration tests.
