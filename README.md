# Reqall Claude Plugin

Persistent semantic memory for Claude Code agents.
Automatically gleans context at session start, records agreed intent before work begins, surfaces file-specific records before edits, documents work incrementally, and persists session results reconciled against that intent — backed by the Reqall knowledgebase.

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
| `UserPromptSubmit` | Throttled nudge to run `reqall:intend` when a prompt starts a task with agreed scope; skips short prompts and slash commands |
| `PreToolUse` (Write/Edit/NotebookEdit) | Surfaces file-specific records (specs, issues, decisions) before a file is modified |
| `PostToolUse` (Write/Edit/NotebookEdit/Bash, async) | Marks the session as active and prompts background documentation of non-trivial work via the `reqall-documenter` agent; throttled |
| `PostToolUse` (ExitPlanMode) | An accepted plan is agreed intent: instructs `reqall:intend` to find or upsert the spec/arch record for the plan and link it before work starts |
| `PostToolUse` (reqall `upsert_record` / `get_record`, async) | Records spec/arch records touched this session to plugin state — written via `upsert_record`, consulted via `get_record` — so the persist step can reconcile the work against them even after compaction. Side-effect only |
| `Stop` | Blocks turn completion (loop-safe) to force the persist step. Sessions with tool or subagent activity, or recorded intent, block on the standard interval; chat-only sessions block on the longer idle interval so decisions made in conversation are still captured. Lists the session's intent records so persist links fulfilled work `implements` its spec and files a blocking todo for any gap |
| `SubagentStop` (async) | Marks the session as active so subagent output (plans, findings) is persisted on the standard cadence. Side-effect only: Claude Code ignores SubagentStop JSON output, so it prints nothing |
| `PreCompact` | Persists unrecorded decisions and work before context compaction loses them; includes the session's intent records and marks them handed-off, so the later Stop asks persist to verify the reconciliation rather than repeat it |

### Intent-before-work

The worker flow the plugin drives is: **search for context → record agreed
intent → do the work → persist and reconcile**.

1. `reqall:context` loads project memory at session start.
2. When scope is agreed — a plan is accepted, or the user asks for a
   specific non-trivial change — `reqall:intend` finds or creates one
   `spec` (new behavior) or `arch` (structural decision) record describing
   what is to be, and links it to related records. Chores, questions and
   single-file fixes never get one.
3. The `upsert_record` / `get_record` PostToolUse hook remembers those
   spec/arch ids — including an existing spec that `intend` selected
   without editing.
4. At Stop / PreCompact, `reqall:persist` writes a `work` record for the
   session and reconciles it: fulfilled intent → `work --implements-->
   spec` and the work is resolved; unfulfilled intent → a `todo` that
   `blocks` the spec. Work records are ephemeral; SLEEP promotes their
   durable content and deletes the log.

### Skills

- `/reqall:context` — Initialize project and gather relevant context before starting work
- `/reqall:intend` — Record agreed intent (one spec or arch record plus links) before starting work
- `/reqall:persist` — Classify and persist all work completed in a session, reconciling it against recorded intent
- `reqall:document` — Document a single work item (agent-only; hidden from the `/` menu)
- `/reqall:triage` — Classify incoming issues, gather structured details, and create prioritized records (user-invoked)
- `/reqall:review` — Interactive review and triage of open records (user-invoked)
- `/reqall:sleep` — Compress memory: consolidate, split, compact, skip, crosslink (user-invoked)

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQALL_API_KEY` | unset | Bearer token for headless/CI use; when set, replaces the OAuth browser flow |
| `REQALL_PROJECT_NAME` | auto-detected | Override project name (else git `origin` org/repo, else the machine project `.machine/<hostname>/<os-user>`) |
| `REQALL_MACHINE_NAME` | short hostname | Overrides the hostname segment of the machine project — set in CI/containers with ephemeral hostnames |
| `REQALL_INTENT_INTERVAL_MIN` | `15` | Minimum minutes between UserPromptSubmit intent nudges (0 disables throttling). The ExitPlanMode trigger is never throttled |
| `REQALL_DOC_INTERVAL_MIN` | `10` | Minimum minutes between PostToolUse documentation prompts (0 disables throttling) |
| `REQALL_PERSIST_INTERVAL_MIN` | `30` | Minimum minutes between Stop persist blocks for sessions with tool/subagent activity (0 disables throttling) |
| `REQALL_IDLE_PERSIST_INTERVAL_MIN` | `120` | Minimum minutes between Stop persist blocks for chat-only sessions (0 disables idle blocks entirely) |

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
