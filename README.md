# Reqall Claude Plugin

Persistent semantic memory for Claude Code agents.
Automatically gleans context before prompts, classifies completed work, and saves plans an& specifications.

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

| Event | Hook | Description |
|-------|------|-------------|
| `UserPromptSubmit` | context | Initializes the project, searches for relevant context, and lists open records |
| `Stop` | persist | Classifies all completed work items and persists them as records with links |
| `SubagentStop` (Plan) | plan | Saves planning output as a specification record |

### Skills

- `/reqall:context` — Initialize project and gather relevant context before starting work
- `/reqall:persist` — Classify and persist all work completed in a session
- `/reqall:review` — Interactive review and triage of open records

### MCP Server

Connects to the Reqall API at `${REQALL_URL}/mcp` with bearer token auth, providing tools for searching, creating, and linking records.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQALL_API_KEY` | (required) | API key for Reqall |
| `REQALL_URL` | `https://www.reqall.net` | Reqall server URL |
| `REQALL_PROJECT_NAME` | auto-detected | Override project name |
| `REQALL_CONTEXT_LIMIT` | `5` | Number of context results |
| `REQALL_RECENCY_HOURS` | `1` | Time window for context |

## Development

```bash
npm install
npm run build    # tsc + bundle hooks with esbuild
npm run clean    # remove dist/
```

The build compiles TypeScript and bundles each hook into a self-contained `.mjs` file (inlining `@reqall/core`) so the plugin works without `node_modules`.

## License

MIT
