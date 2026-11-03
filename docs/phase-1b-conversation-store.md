# Phase 1b: Conversation store research notes

Raw notes from primary sources, to write up later. Quotes are from the linked pages; where only a summary of a page was available, that's marked.

## OpenAI Agents SDK: Sessions

- https://openai.github.io/openai-agents-python/sessions/
- https://openai.github.io/openai-agents-python/sessions/advanced_sqlite_session/
- https://openai.github.io/openai-agents-python/sessions/sqlalchemy_session/

- Protocol: `get_items()`, `add_items(items)`, `pop_item()` ("Remove and return the most recent item"), `clear_session()`.
- Before each run, the runner calls `get_items` and prepends the history to the new input. After the run, it stores every new item (user input, assistant responses, tool calls).
- The stored unit is an **item**, not a message. Advanced SQLite `message_type` values include `user`, `assistant`, `tool_call`.
- `SessionSettings(limit=N)` caps how many items are fetched. `RunConfig.session_input_callback(history, new_input)` can prune history before the model call, and only new-turn items are persisted.
- Server-managed alternative: a session can't be combined with `conversation_id` / `previous_response_id` / `auto_previous_response_id`. `OpenAIConversationsSession(conversation_id=...)` stores history in the Conversations API.
- Compaction: `OpenAIResponsesCompactionSession` wraps another session and serializes `add_items` / `pop_item` / `clear_session` with compaction.
- Correction without branches: call `pop_item()` twice (assistant, then user) and re-run.
- **Branches (AdvancedSQLiteSession):** `create_branch_from_turn(turn)`, `create_branch_from_content(text)`, `list_branches()`, `switch_to_branch(id)`, `delete_branch(id)`, `get_conversation_turns()` (includes `can_branch`). "Branch IDs are never reused."
- Advanced SQLite schema:
  - `message_structure(id, session_id, message_id, branch_id DEFAULT 'main', message_type, sequence_number, user_turn_number, branch_turn_number, tool_name, created_at)`
  - `branch_reservations(session_id, branch_id)`
  - `turn_usage(session_id, branch_id, user_turn_number, requests, input_tokens, output_tokens, total_tokens, …)`. Usage is recorded only when you call `store_run_usage(result)`.
- Security, from a summary of the page's later sections: session IDs select history but don't authorize access, so the app has to.

## Claude Agent SDK: Sessions

- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/session-storage
- https://code.claude.com/docs/en/sessions

- "A session is the conversation history the SDK accumulates while your agent works. It contains your prompt, every tool call the agent made, every tool result, and every response."
- Stored as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`. The entry format is internal and may change between versions.
- **Continue / resume / fork:**
  - `continue: true` picks up the most recent session in the directory.
  - `resume: <id>` picks up a specific one.
  - `resume` + `forkSession: true` copies the history into a new session ID and leaves the original unchanged.
  - Forking "branches the conversation history, not the filesystem."
- The caller sends only the new prompt, and the SDK loads the history.
- **Pluggable `SessionStore`:**
  - Required methods: `append(key, entries)` and `load(key)`.
  - Optional methods: `listSessions`, `listSessionSummaries`, `delete`, `listSubkeys`.
  - `SessionKey = { projectKey, sessionId, subpath? }`.
  - Reference adapters for S3, Redis and Postgres, plus a conformance test suite.
- Local JSONL is written first, then mirrored to the store with `append()`. `load` must return entries "deep-equal" to what was appended, in order.
- `getSessionMessages` returns "the linked message chain the agent would see on resume". For example, 503 raw entries can come back as 18 messages, because auto-compaction swaps earlier turns for a summary while the raw transcript keeps every entry.
- **Concurrency:**
  - Concurrent `append()` calls for one session can race. "Serialize with a transaction, compare-and-swap, or a per-session lock."
  - Deduplicate by `entry.uuid`.
  - Resuming one session in two places without forking interleaves both into one transcript.

## OpenAI ChatKit (Python): Threads and Store

- https://openai.github.io/chatkit-python/concepts/threads/
- https://openai.github.io/chatkit-python/api/chatkit/store/
- https://openai.github.io/chatkit-python/concepts/thread-stream-events/
- https://openai.github.io/chatkit-python/api/chatkit/server/
- https://openai.github.io/chatkit-python/api/chatkit/types/

- A thread is "an ordered timeline" of items, "persisted by your store implementation."
- `ThreadMetadata`: `id`, `title`, `created_at`, `status` (`active` | `locked` | `closed`, the last two with a `reason`), `metadata`.
- **Typed items**, all with `id`, `thread_id`, `created_at`:
  - Visible: `user_message`, `assistant_message`, `client_tool_call` (`pending` | `completed`), `widget`, `generated_image`, `structured_input`, `workflow`, `task`.
  - Not sent to the client: `hidden_context_item`, `sdk_hidden_context`.
  - `end_of_turn`.
- **Store:** every method takes `context: TContext` last ("Arbitrary per-request context provided by the caller"), which is how user scoping reaches storage.
  - Threads: `load_thread`, `save_thread`, `load_threads(limit, after, order)`, `delete_thread`.
  - Items: `load_thread_items(thread_id, after, limit, order)` → `Page`, `add_thread_item` ("Persist a newly created thread item"), `save_item` ("Upsert a thread item by id"), `load_item`, `delete_thread_item`.
  - IDs: `generate_thread_id`, `generate_item_id(item_type, thread)` ("Override this method to customize item ID generation").
  - Attachments: `save_attachment`, `load_attachment`, `delete_attachment`.
- **When items are saved during streaming:** "ThreadItemAddedEvent does not persist the item. ChatKitServer saves on ThreadItemDoneEvent/ThreadItemReplacedEvent."
  - Done → `add_thread_item`, Replaced → `save_item`, Removed → `delete_thread_item`.
  - Updated (text deltas) only changes an in-memory copy of the item until it's done.
- **Cancel:** a non-empty partial assistant message is persisted, then an `SDKHiddenContextItem` is added: "The user cancelled the stream. Stop responding to the prior request."
- **Retry** (`threads.retry_after_item`): the target must be a `UserMessageItem`. Every item after it is deleted with `delete_thread_item`, then `respond()` runs again. No branch or edit model appears in the pages read.
- Model input: `ThreadItemConverter` / `simple_to_agent_input(items)` turns stored items into Agents SDK input. Hidden context is wrapped as "Hidden context for the agent (not shown to the user)". From a summary of the agents page: https://openai.github.io/chatkit-python/api/chatkit/agents/

## AI SDK: Chatbot message persistence

- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence

- Once messages are persisted, "you might want to send only the last message to the server."
- The server loads the stored history by chat ID, appends the new message, and validates with `validateUIMessages` (passing tools and a metadata schema) "before sending them to the model".
- "You need server-side generated IDs to ensure consistency across sessions and prevent ID conflicts."

## LangGraph: Checkpointers and time travel

- https://docs.langchain.com/oss/python/langgraph/checkpointers
- https://docs.langchain.com/oss/javascript/langgraph/use-time-travel.md
- https://docs.langchain.com/langsmith/human-in-the-loop-time-travel

- "The checkpointer uses thread_id as the primary key for storing and retrieving checkpoints."
- A checkpoint is a snapshot of the graph state at each super-step, including its parent checkpoint config.
- Pass `checkpoint_id` to load a specific snapshot, or omit it for the latest.
- Replay resumes from a prior checkpoint. A fork uses `update_state` on a prior checkpoint and creates a new checkpoint on the same thread.

## Tree / active-leaf chat apps

- https://trigger.dev/docs/ai-chat/patterns/branching-conversations.md
- https://www.chatjs.dev/docs/features/branching.md
- https://ably.com/docs/ai-transport/durable-sessions/conversation-tree
- LibreChat source, via a mirror (not upstream): https://huggingface.co/spaces/helloya20/chat/blob/main/api/models/Message.js and https://huggingface.co/spaces/helloya20/chat/blob/main/api/models/convoStructure.spec.js

- Trigger.dev: ChatGPT, Open WebUI and LibreChat store messages as a tree with parent pointers. The active branch is found by walking from a leaf up the parent pointers to the root, then reversing.
- ChatJS / Ably: editing a message or regenerating a reply creates a sibling, and earlier versions stay in the tree.
- LibreChat: messages store `parentMessageId` (`null` for the root), and a `buildTree` helper in `librechat-data-provider` rebuilds the tree.

## assistant-ui history format (checked in `node_modules`)

`@assistant-ui/core/dist/adapters/thread-history.d.ts` and `runtime/utils/message-repository.d.ts`:

```ts
MessageStorageEntry<T>     { id; parent_id: string | null; format; content: T }
MessageFormatRepository<T> { headId?: string | null; messages: MessageFormatItem<T>[] }
ThreadHistoryAdapter       { load(); append(item); update?(item, localId); delete?(items) }
```

The history format is a tree (`parent_id`) with an active leaf (`headId`).

## Groundwork state as of PR #5

- `POST /chat` takes `{ id, message, parentId }`. The server rebuilds the conversation from stored history up to `parentId`.
- Storage replaces everything after `parentId`, which is the same as ChatKit's `retry_after_item`, so old branches are lost.
- Turns on one conversation run in order through an in-memory queue, a per-session lock like the one Claude's docs describe.
- History loads as a linear chain with no `headId`.

## Open questions (my synthesis)

- Should storage become an append-only tree with `parentId` per message and `headId` on the conversation, as in the chat apps and assistant-ui's format? Or ChatKit's approach (typed items, upserts, delete on retry)? Or a mix: typed items and per-request context from ChatKit, the tree shape from the chat apps?
- Do typed items earn their keep for us (`hidden_context`, `end_of_turn`, tool-call status), or are AI SDK UI message parts enough?
- Where should compaction live: keep the raw record and derive the model's context (Claude, OpenAI `session_input_callback`)?
- Should items be saved when they're done, as ChatKit does, which would let the turn queue go?
