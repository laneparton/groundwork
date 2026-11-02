## The Goal

In the first phase - lets settle on a basic chat web application architecture. It should be nothing more than a very elementary composition of all the foundational stack choices - setting us up for further experiments.

### Scope:

- BetterAuth in place - with a basic login screen
- Basic SQLite conversation storage - the server saves each conversation per user, so chats survive a reload
- Basic AI SDK Agent - with a single `query_sql` tool that runs read-only queries against BigQuery
- Basic SPA + Assistant UI design - copied from their site as much as possible
- Initial data warehouse connection - read-only queries against Google's public deps.dev dataset (`bigquery-public-data.deps_dev_v1`), so there's real data to query without hosting our own

### Out of Scope:

- Evaluation foundation/framework - I'll dedicate an entire iteration to this and give it the space it deserves.

## Architecture Diagrams

## Lessons Learned

### Effect - a powerhouse

### BigQuery Limits

## Future Work

Honestly these are more forward-facing notes - that need to be planned for and may not have a home yet.

- System prompt composition - we've got a very elementary system prompt. It's not what I would call production-grade. We'll likely need evals in place to spend some time here.
