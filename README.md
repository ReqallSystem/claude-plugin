# Reqall Claude Plugin

Persistent semantic memory for Claude Code agents.
Automatically gleans context at session start, surfaces file-specific records before edits, documents work incrementally, and persists session results — backed by the Reqall knowledgebase.

## Installation

```
/plugin marketplace add ReqallSystem/plugins
/plugin install reqall@reqall-plugins
```

## Setup

When you enable the plugin, Claude Code prompts for:

- **Reqall API key** (required) — from your Reqall account settings at
  [reqall.net](https://www.reqall.net). Stored in secure storage
  (masked, not written to `settings.json`).
- **Reqall server URL** — defaults to `https://www.reqall.net`; change it
  only if you self-host.

Reconfigure later via `/plugin`. Upgrading from a version that used the
`REQALL_API_KEY` / `REQALL_URL` environment variables: the MCP connection now
reads plugin config instead, so enter your key once when prompted.

## What It Does

### Hooks

All hooks are dependency-free Node scripts (`dist/src/hooks/*.js`) that read
the hook JSON payload from stdin and emit structured JSON output
(`additionalContext` / `decision`), so they work identically on macOS, Linux,
and Windows.

| Event | Behavior |
|-------|----------|
| `SessionStart` | Injects project context instructions — initialize the project, search for relevant records, list open work. Also re-fires after context compaction (`source: compact`), restoring Reqall awareness in long sessions |
| `PreToolUse` (Write/Edit/NotebookEdit) | Surfaces file-specific records (specs, issues, decisions) before a file is modified |
| `PostToolUse` (Write/Edit/NotebookEdit/Bash, async) | Marks the session as active and prompts background documentation of non-trivial work via the `reqall-documenter` agent; throttled |
| `Stop` | Blocks turn completion (loop-safe) to force the persist step. Sessions with tool or subagent activity block on the standard interval; chat-only sessions block on the longer idle interval so decisions made in conversation are still captured |
| `SubagentStop` (async) | Marks the session as active so subagent output (plans, findings) is persisted on the standard cadence. Side-effect only: Claude Code ignores SubagentStop JSON output, so it prints nothing |
| `PreCompact` | Persists unrecorded decisions and work before context compaction loses them |

### Skills

- `/reqall:context` — Initialize project and gather relevant context before starting work
- `/reqall:persist` — Classify and persist all work completed in a session
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

Connects to the Reqall API at `${user_config.server_url}/mcp` with
`Authorization: Bearer ${user_config.api_key}` — both values come from the
plugin configuration prompted at enable time (`.mcp.json`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQALL_PROJECT_NAME` | auto-detected | Override project name (else git `origin` org/repo, else directory name) |
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
