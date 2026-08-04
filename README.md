# Reqall Claude Plugin

Persistent semantic memory for Claude Code agents.
Automatically gleans context at session start, surfaces file-specific records before edits, documents work incrementally, and persists session results — backed by the Reqall knowledgebase.

## Installation

```
/plugin marketplace add ReqallSystem/plugins
/plugin install reqall@reqall-plugins
```

## Setup

Set your Reqall API key as an environment variable:

```bash
export REQALL_API_KEY="your-api-key"
```

Optionally configure the server URL (defaults to `https://www.reqall.net`):

```bash
export REQALL_URL="https://reqall.net"
```

## What It Does

### Hooks

All hooks are dependency-free Node scripts (`dist/src/hooks/*.js`) that read
the hook JSON payload from stdin and emit structured JSON output
(`additionalContext` / `decision`), so they work identically on macOS, Linux,
and Windows.

| Event | Behavior |
|-------|----------|
| `SessionStart` | Injects project context instructions — initialize the project, search for relevant records, list open work |
| `PreToolUse` (Write/Edit/NotebookEdit) | Surfaces file-specific records (specs, issues, decisions) before a file is modified |
| `PostToolUse` (Write/Edit/NotebookEdit/Bash, async) | Prompts background documentation of non-trivial work via the `reqall-documenter` agent; throttled |
| `Stop` | Blocks turn completion once (throttled, loop-safe) to force the persist step |
| `SubagentStop` | Plan agents: saves the plan as a spec record; other agents: notes outputs for later persistence |
| `PreCompact` | Persists unrecorded decisions and work before context compaction loses them |

### Skills

- `/reqall:context` — Initialize project and gather relevant context before starting work
- `/reqall:persist` — Classify and persist all work completed in a session
- `/reqall:document` — Document a single work item (used by the background documenter agent)
- `/reqall:triage` — Classify incoming issues, gather structured details, and create prioritized records (user-invoked)
- `/reqall:review` — Interactive review and triage of open records (user-invoked)
- `/reqall:sleep` — Compress memory: consolidate, split, compact, skip, crosslink (user-invoked)

Skills pre-approve the Reqall MCP tools via `allowed-tools`, so they run
without permission prompts.

### Agents

- `reqall-documenter` — background subagent that classifies and persists a
  single work item, skipping trivial changes.

### MCP Server

Connects to the Reqall API at `${REQALL_URL}/mcp` with
`Authorization: Bearer ${REQALL_API_KEY}` (environment variables are expanded
by Claude Code at connection time).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQALL_API_KEY` | (required) | API key for Reqall |
| `REQALL_URL` | `https://www.reqall.net` | Reqall server URL |
| `REQALL_PROJECT_NAME` | auto-detected | Override project name (else git `origin` org/repo, else directory name) |
| `REQALL_DOC_INTERVAL_MIN` | `10` | Minimum minutes between PostToolUse documentation prompts (0 disables throttling) |
| `REQALL_PERSIST_INTERVAL_MIN` | `30` | Minimum minutes between Stop persist blocks per session (0 disables throttling) |

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
