# Reqall Claude Plugin

Persistent semantic memory for Claude Code agents.
Automatically gleans context at session start, records agreed intent before work begins, surfaces file-specific records before edits, documents work incrementally, persists session results reconciled against that intent, and surfaces memory changes made by other sessions while you work — backed by the Reqall knowledgebase.

## Installation

```
/plugin marketplace add ReqallSystem/plugins
/plugin install reqall@reqall-plugins
```

## Setup

No configuration is required. On first connection Claude Code signs you in
through your browser using OAuth, so there is no key to copy and nothing to
carry between machines.

One optional setting, available via `/plugin`:

- **Reqall server URL** — the base origin only, e.g. `https://www.reqall.net`.
  Do **not** include the `/mcp` path; the plugin appends it. Change this only
  if you self-host.

### Headless and CI: API key

Where no browser is available, set `REQALL_API_KEY` in the environment and
the plugin sends it as a bearer token instead of starting OAuth. Get a key
from your Reqall account settings at [reqall.net](https://www.reqall.net).

```
REQALL_API_KEY=rq_... claude -p "..."
```

The key is read by a `headersHelper` script on every connection, never stored
by the plugin, and never written to `settings.json`. Leave the variable unset
on interactive machines so the browser flow is used; a set key disables OAuth
for the server.

On SSH without a local browser, `claude mcp login reqall --no-browser` prints
the authorization URL to open elsewhere and lets you paste the redirect back.

Upgrading from a version that prompted for an API key at enable time: nothing
to do. That setting is gone and the browser flow replaces it. Because it lived
in OS secure storage, it never followed you to a new machine; OAuth removes
that failure mode entirely.

## What It Does

### Hooks

All hooks are dependency-free Node scripts (`dist/src/hooks/*.js`) that read
the hook JSON payload from stdin and emit structured JSON output
(`additionalContext` / `decision`), so they work identically on macOS, Linux,
and Windows.

| Event | Behavior |
|-------|----------|
| `SessionStart` | Injects project context instructions — initialize the project, search for relevant records, list open work. Also re-fires after context compaction (`source: compact`), restoring Reqall awareness in long sessions |
| `UserPromptSubmit` | Three jobs: remembers a labelled `project_name=org/repo` selection for sessions outside a repo; a throttled nudge to run `reqall:intend` when a prompt starts a task with agreed scope (short prompts and slash commands skipped); and subscription updates — with `REQALL_API_KEY` the hook polls the server itself and injects `## Reqall updates since last turn`, otherwise it asks the model to call `poll_subscriptions` once the session has subscribed |
| `PreToolUse` (Write/Edit/NotebookEdit) | Surfaces file-specific records (specs, issues, decisions) before a file is modified |
| `PostToolUse` (Write/Edit/NotebookEdit/Bash, async) | Marks the session as active and prompts background documentation of non-trivial work via the `reqall-documenter` agent; throttled. Bash counts only when the command can plausibly write — `git status`, `ls`, `cat`, `rg` and similar are ignored; compounds, pipes, redirects and substitutions count |
| `PostToolUse` (ExitPlanMode) | An accepted plan is agreed intent: instructs `reqall:intend` to find or upsert the spec/arch record for the plan and link it before work starts |
| `PostToolUse` (reqall `upsert_record` / `get_record` / `upsert_link` / `upsert_project` / `subscribe_project` / `poll_subscriptions`, async) | Session bookkeeping, side-effect only. Spec/arch records touched this session — written via `upsert_record`, consulted via `get_record` — so persist can reconcile the work against them even after compaction; every written record id, so polls can drop the session's own writes (retired once a poll has delivered them, so a later edit from another session of the same account still shows); an outcome record whose inline links `implements`/`blocks` a tracked intent marks it reconciled, as does an `upsert_link` repair; the project id and the model's subscription with the project it was bound under, so later prompts know what to poll and can rebind when a `project_name=` selection changes |
| `Stop` | Blocks turn completion (loop-safe) to force the persist step, then verifies it. Sessions with tool or subagent activity, or recorded intent, block on the standard interval; chat-only sessions block on the longer idle interval so decisions made in conversation are still captured. Lists the session's intent records so persist writes the work record with an inline `implements` link to its spec, and a gap todo with an inline `blocks` link, in the same `upsert_record` call. A block is a request, not proof: nothing clears until the `stop_hook_active` pass, which clears intents that an outcome record linked, re-blocks once naming any written intent still unlinked, and otherwise leaves the owed intent on file for the next Stop |
| `SubagentStop` (async) | Marks the session as active so subagent output (plans, findings) is persisted on the standard cadence. Side-effect only: Claude Code ignores SubagentStop JSON output, so it prints nothing |
| `PreCompact` | Persists unrecorded decisions and work before context compaction loses them; includes the session's intent records and marks them handed-off, so the later Stop asks persist to verify the reconciliation rather than repeat it |
| `SessionEnd` | Deletes the session's state files from `CLAUDE_PLUGIN_DATA` and, in API-key mode, releases the hook's subscription cursor. Output is ignored, so it prints nothing |

### What the hooks can and cannot guarantee

| Hook | Guarantee |
|------|-----------|
| SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact | Advisory: they inject instructions the model is expected to follow. None of them can call Reqall on the model's behalf, except UserPromptSubmit polling in API-key mode |
| Stop | The only hook that can hold the turn. It blocks once for persist and once more if a tracked intent is left unlinked, then lets the turn end; anything still owed is listed again at the next Stop |
| SubagentStop, SessionEnd | Side-effect only; Claude Code ignores their output |
| All | Fail open. A hook error never blocks the model and never claims persistence happened |

Hooks hold no OAuth token — Claude Code keeps that for the MCP connection — so
no hook reaches the server unless `REQALL_API_KEY` is set. Verification of
persistence is therefore observational: the `PostToolUse` tracker sees the
model's `upsert_record` results, including per-link `created` / `existing` /
`error` outcomes, and the Stop hook judges from those.

### Intent-before-work

The worker flow the plugin drives is: **search for context → record agreed
intent → do the work → persist and reconcile**.

1. `reqall:context` loads project memory at session start.
2. When scope is agreed — a plan is accepted, or the user asks for a
   specific non-trivial change — `reqall:intend` finds or creates one
   `spec` (new behavior) or `arch` (structural decision) record describing
   what is to be, and links it to related records in the same
   `upsert_record` call (inline `links`, server 2026.9+). Chores, questions
   and single-file fixes never get one.
3. The `upsert_record` / `get_record` PostToolUse hook remembers those
   spec/arch ids — including an existing spec that `intend` selected
   without editing.
4. At Stop / PreCompact, `reqall:persist` writes a `work` record for the
   session and reconciles it: fulfilled intent → `work --implements-->
   spec` and the work is resolved; unfulfilled intent → a `todo` that
   `blocks` the spec. Work records are ephemeral; SLEEP promotes their
   durable content and deletes the log.
5. The Stop hook's verification pass checks that each written intent got
   such a link from an outcome record this session. An unlinked intent is
   asked for once more, then carried to the next Stop — it is never
   forgotten because persist was merely asked.

### Subscriptions

Reqall can tell an agent when memories change in a project. Each session
subscribes to its bound project once, with `subscriber` set to the Claude
Code session id so every session keeps its own cursor, and polls at the
start of each prompt. Changes by other sessions, teammates, or SLEEP arrive
as `## Reqall updates since last turn`; the session's own writes are
omitted; a quiet poll adds nothing; a server that predates the tools is
detected once and left alone.

- **OAuth sessions (default):** the `reqall:context` skill creates the
  subscription and the `UserPromptSubmit` hook asks the model to call
  `poll_subscriptions` on each prompt. The subscription cannot be released
  from a hook, so it is left for the server to expire.
- **`REQALL_API_KEY` set:** the hook binds the project, subscribes, polls
  and injects the block itself, with no model round-trip, and
  `SessionEnd` releases the cursor.

`REQALL_POLL_INTERVAL_MIN` throttles polling in both modes; the default
`0` polls every prompt. Slash commands never poll.

### Skills

- `/reqall:context` — Initialize project and gather relevant context before starting work
- `/reqall:intend` — Record agreed intent (one spec or arch record plus links) before starting work
- `/reqall:persist` — Classify and persist all work completed in a session, reconciling it against recorded intent
- `reqall:document` — Document a single work item (agent-only; hidden from the `/` menu)
- `/reqall:triage` — Classify incoming issues, gather structured details, and create prioritized records (user-invoked)
- `/reqall:review` — Interactive review and triage of open records (user-invoked)
- `/reqall:sleep` — Compress memory: consolidate, split, compact, skip, crosslink, and promote or discard work logs (user-invoked)

Skills pre-approve the Reqall MCP tools via `allowed-tools`, so they run
without permission prompts. Tool names are listed under both the plugin MCP
namespace (`mcp__plugin_reqall_reqall__*`) and the claude.ai connector
namespace (`mcp__Reqall__*`) so pre-approval works on both surfaces.

### Agents

- `reqall-documenter` — background subagent (pinned to Haiku, max 10 turns)
  that classifies and persists a single work item, skipping trivial changes.

### MCP Server

Connects to the Reqall API at `${user_config.server_url}/mcp` (`.mcp.json`).

Headers come from a `headersHelper` script, `dist/src/auth-headers.js`,
which Claude Code runs on every connection and again after a 401/403:

- `REQALL_API_KEY` set → `{"Authorization": "Bearer <key>"}`. Static key
  auth; OAuth is skipped for the server.
- unset → `{}`. The server answers the unauthenticated request with an
  RFC 9728 challenge, so Claude Code discovers the authorization server,
  registers dynamically, and runs the PKCE browser flow on its own. Tokens
  are then managed and refreshed by Claude Code.

The helper reads the environment rather than `${user_config.*}` because
Claude Code refuses to substitute plugin config into shell-executed helpers.

## Project identity

Preserve explicit operation arguments (including a SLEEP target). Otherwise the
hook-provided `project_name` or delegated binding is authoritative: reuse its exact
identity through recall, work, persistence, and verification; do not re-derive it.
With no supplied binding, automatic discovery uses this order:

1. Nonempty trimmed `REQALL_PROJECT_NAME` (no additional host setting).
2. Network Git `origin` (HTTP(S), SSH, Git, or SCP): remove trailing slashes and
   terminal `.git`, retain the final two path segments, including nested namespaces.
   Local paths and `file:` remotes fall through.
3. Explicit user `project_name`/`project` label with `:` or `=`, or the retained
   session selection. Single/double/backtick quotes are supported; strip sentence
   punctuation only from unquoted values. Incidental paths, URLs, examples in
   synthetic/ASYNC reports, and arbitrary slash tokens are not selections.
4. Nearest valid ancestor `.reqall.yml`, then `.reqall.yaml` identity.
5. Nearest valid package identity: `package.json`, `go.mod`, then `Cargo.toml`
   at each directory before moving upward.
6. Exact POSIX cwd-relative path within `REQALL_WORKSPACE_ROOT` or the nearest
   ancestor regular `.reqall-workspace` marker.
7. `.machine/<short-lower-hostname>/<os-user>`; never an unconstrained cwd basename.
   Use the OS account, not `USER`/`USERNAME`. `REQALL_MACHINE_NAME` replaces the
   whole hostname segment (sanitize/lowercase, preserving override dots).

Metadata readers accept regular UTF-8 files at most 64 KiB and skip malformed,
unreadable, oversized, unsupported, or non-string values. Search ancestors only
through the known containing workspace root (inclusive), otherwise filesystem
root. YAML supports simple top-level string `project` (`name` alias), matched
quotes and comments, not complex YAML, ambiguous duplicates, or plain numeric,
boolean/null values. Package JSON accepts a string name and removes `@` only for
a valid npm scope; Go retains the complete declared module including domain and
version; Cargo accepts only a simple quoted `[package]` name, not bin/dependency
names. Automatic identifiers allow ASCII letters/digits, `_`, `-`, `.` in
slash-separated segments; reject absolute, drive/UNC, backslash, tilde, empty,
`.` and `..` segments rather than repairing them. Explicit names retain historical
spelling apart from outer whitespace; intentional metadata such as `src` is valid.

Resolve filesystem paths before workspace containment checks (including symlinks).
Relative roots resolve from cwd; `~/` expands to the current home. An invalid or
non-containing explicit root does not fall back to a marker. Cwd equal to root
has no relative identity. Preserve every relative segment, including `src`/`work`.
Account-wide preferences may deliberately route to `.user`, and machine-specific
work to the machine project. Do not migrate or rename existing records.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQALL_API_KEY` | unset | Bearer token for headless/CI use; when set, replaces the OAuth browser flow |
| `REQALL_PROJECT_NAME` | auto-detected | Trimmed explicit override; otherwise use the Project identity precedence below |
| `REQALL_URL` | `https://www.reqall.net` | Server origin used by hooks in API-key mode (the MCP connection itself uses the plugin's `server_url` setting) |
| `REQALL_MACHINE_NAME` | short hostname | Overrides the hostname segment of the machine project — set in CI/containers with ephemeral hostnames |
| `REQALL_INTENT_INTERVAL_MIN` | `15` | Minimum minutes between UserPromptSubmit intent nudges (0 disables throttling). The ExitPlanMode trigger is never throttled |
| `REQALL_DOC_INTERVAL_MIN` | `10` | Minimum minutes between PostToolUse documentation prompts (0 disables throttling) |
| `REQALL_PERSIST_INTERVAL_MIN` | `30` | Minimum minutes between Stop persist blocks for sessions with tool/subagent activity (0 disables throttling) |
| `REQALL_IDLE_PERSIST_INTERVAL_MIN` | `120` | Minimum minutes between Stop persist blocks for chat-only sessions (0 disables idle blocks entirely) |
| `REQALL_POLL_INTERVAL_MIN` | `0` | Minimum minutes between subscription polls (0 polls every prompt) |

## Development

```bash
npm install
npm run build    # tsc → dist/
npm test         # build + node --test (spawns each hook with stdin JSON)
npm run clean    # remove dist/
```

`dist/` is committed because the plugin installs directly from this git
repository — rebuild and commit `dist/` whenever `src/` changes.

## License

MIT
