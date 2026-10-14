# Groundwork evals

Python DeepEval evaluates the agent through the same authenticated `/chat`
endpoint used by the app. The runner does not recreate the agent in Python or
bypass authentication. Start the server normally before running it.

## Layout

```text
evals/
├── harness/                 # Auth, stream capture, case contracts, exact fact checks
├── suites/
│   ├── conftest.py          # Authenticated execution and DeepEval assertions
│   ├── conversation/        # Greeting and general conversation behavior
│   │   ├── cases.py
│   │   └── test_conversation.py
│   └── warehouse/
│       ├── conftest.py      # Warehouse scoring configuration
│       ├── metrics.py
│       ├── lookups/         # Package lookup and missing-data behavior
│       ├── versions/        # Semantic version ordering
│       ├── requirements/    # Declared dependencies versus peers and resolved versions
│       ├── advisories/      # Alias deduplication and conflicting severity evidence
│       └── graphs/          # Deferred graph cases awaiting bounded snapshot goldens
└── tests/harness/           # Offline harness tests
```

Every theme keeps its `cases.py` beside its `test_*.py` suite. Warehouse themes
share scoring criteria; conversation behavior has its own criteria. The shared
harness contains no deps.dev-specific goldens. Themes can be run independently
using their directories, and individual cases can be selected with `-k`.


The shared harness has no warehouse cases or scoring criteria. The suites use native
pytest fixtures and DeepEval assertions; there is no custom CLI or evaluation loop. Each evaluation
suite owns its metrics and keeps its cases alongside the suite. The initial
cases use a small Python dataclass so long prompts and expected answers can be
written as readable Python. JSON can still be used by a future suite when it
fits the data better.

## Setup

From the repository root:

```sh
uv sync --project evals
cp -n evals/.env.example evals/.env
uv run --directory evals python -m harness.account
```

Set `EVAL_EMAIL` and `EVAL_PASSWORD` in `evals/.env` for a dedicated local account.
The setup command creates it through Better Auth; if it already exists, the
command verifies its login instead. It never resets an existing password.
For a deployed environment, provision the account using that environment's
normal process and set `EVAL_BASE_URL` to its trusted authentication origin.

Each run signs in with email/password, retains the HTTP-only session cookie in
memory, sends the evaluation questions, and signs out afterward. Credentials,
cookies, and API keys are excluded from reports and Git.

The local setup already has a generated password in the ignored `evals/.env`.
Do not copy the example over that file unless you want to replace its settings.

`OPENAI_API_KEY` is loaded from `apps/server/.env` unless set in the shell or
`evals/.env`. `EVAL_JUDGE_MODEL` selects the DeepEval judge and defaults to
`gpt-4.1-mini`. This is independent of the server's `CHAT_MODEL`. The agent's
BigQuery configuration and query limits remain on the server.

## Run

```sh
# All verified cases, with DeepEval scores
uv run --directory evals --env-file .env deepeval test run suites

# One warehouse theme
uv run --directory evals --env-file .env deepeval test run suites/warehouse/advisories

# One case
uv run --directory evals --env-file .env deepeval test run suites/warehouse -k react-license

# List cases without agent, warehouse, or judge calls
uv run --directory evals pytest suites --collect-only
```

These commands call the live agent and warehouse. `pytest --collect-only` lists cases without running the agent or judge. Cases run sequentially.
Each case starts a fresh conversation. There are no automatic agent retries by
the runner.

Seven verified cases run today: two package lookups, one semantic-version
question, one dependency/peer requirement question, two advisory questions,
and one greeting. Warehouse goldens were checked against live deps.dev data on
2026-10-14. Source comments record that verification date; review live-data
facts when upstream releases or advisory metadata change.

Two graph questions are also collected, but explicitly skipped. Their cases
include reference SQL and the reason a golden is not available: dependency
queries estimated 102–185 GB before larger joins, above the 20 GB cap. They need
an affordable bounded warehouse snapshot and independently verified results
before they can become scored evals. No expected graph counts are fabricated,
and skipped cases are not coverage evidence.

DeepEval scores:

- **Tool Correctness:** checks expected tool names. SQL text is not compared
  literally, so equivalent queries and schema discovery are allowed. This
  metric does not establish that the SQL itself is correct.
- **Verified facts:** deterministic checks of critical answer tokens and exact
  identifier sets. The CVE case checks all five identifiers, not just the count.
  These checks supplement semantic judging, which handles negation, interpretation,
  and which count or score belongs to which entity.
- **Answer correctness (G-Eval):** compares the answer with the expected result
  and the observed tool inputs/outputs. The starting passing threshold is 0.8;
  treat it as a baseline setting to calibrate with reviewed cases.

The runner records failed calls and retries rather than dropping them.
Authentication failures, stream errors, unfinished calls, and incomplete streams
fail the run rather than being scored as successful answers. Failed stream traces
are preserved for diagnosis, including tool calls when the agent returns no answer.
Session credentials are hidden from object representations in pytest failures. A failing metric
also gives the process a nonzero exit code.

Raw answers, SQL inputs, and tool results are saved to
`evals/reports/<timestamp>/`. DeepEval saves its scored run export to
`evals/reports/` using `DEEPEVAL_RESULTS_FOLDER`.
Keep these reports locally for baseline comparisons. No Confident AI account is
required; do not configure a Confident AI key unless you intend to use its
hosted reporting. DeepEval telemetry is disabled by default.

This is an initial single-turn baseline, not broad coverage of warehouse-querying
quality. Add reviewed cases for joins, aggregations, ambiguity, query failures,
and multi-turn questions as the harness develops. Since the dataset is live,
review expected facts if upstream metadata changes.

## Check the runner without model or warehouse calls

```sh
uv run --directory evals pytest
uv run --directory evals ruff check .
uv run --directory evals ruff format --check .
```

These ordinary tests cover cookie propagation, rejected login, tool retries,
stream errors, incomplete responses, retained failure traces, exact identifier-set checks,
and deterministic metric failures. They are separate from DeepEval agent
scores. The warehouse suite uses DeepEval's native `assert_test()` integration. Prefer
`deepeval test run` for scored runs and ordinary `pytest` for the offline harness tests.

## Python quality

Ruff settings are explicit in `pyproject.toml` and target Python 3.11. Checks cover
undefined names, unused code and arguments, import order, type annotations,
common bugs, broad exception handling, security mistakes, return flow, pytest
practices, and function complexity. Functions have a complexity ceiling of 15.

Only the offline tests may use assertions and deliberately fake credentials.
Generated reports and DeepEval state are excluded even when passed explicitly.
The formatter uses 100-column lines, double quotes, spaces, and LF line endings.
The Ruff minor version is constrained and dependencies are locked with uv.
