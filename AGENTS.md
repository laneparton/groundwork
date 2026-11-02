# Repository guidance

- Use the root Oxfmt configuration. Run `npm run format` and `npm run format:check` after editing application code.
- Run `npm run lint` from the root to check both applications, including the vendored anti-slop rules.
- Keep Effect handlers focused on the request flow. Put session checks, model configuration, and streaming lifecycle details in their owning modules.
- Preserve request cancellation when changing streamed responses. Run `npm test --prefix apps/server` and `npm test --prefix apps/web`; the web suite is the cross-app integration test for auth, streaming, and cancellation.
- Keep the vendored rules unchanged during application cleanup. Record intentional rule changes and upstream updates in `tools/oxlint/anti-slop/UPSTREAM.md`.
- Do not format downloaded docs, generated route trees, lockfiles, or vendored rules.
- Write commit messages in Conventional Commits format, such as `feat(web): add chat history`. Commitlint enforces this, and the pre-commit hook formats and lints staged files. Do not bypass the hooks with `--no-verify`.
