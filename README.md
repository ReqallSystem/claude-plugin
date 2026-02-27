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

Optionally configure the server URL (defaults to `https://reqall.net`):

```bash
export REQALL_URL="https://reqall.net"
```

## What It Does

### Hooks

| Event | Hook | Description |
|-------|------|-------------|
| `UserPromptSubmit` | context | Searches Reqall for relevant context before the agent responds |
| `Stop` | classify | Classifies completed work and persists it as a record |
| `SubagentStop` (Plan) | plan | Saves planning output as a specification record |

### Skills

- `/reqall:issues` — Create, list, search, and update issues
- `/reqall:projects` — List projects, view records, manage context
- `/reqall:specs` — Document requirements and architecture decisions
- `/reqall:review-issues` — Interactive issue grooming session
- `/reqall:review-specs` — Interactive spec review and validation

### MCP Server

Connects to the Reqall API at `${REQALL_URL}/mcp` with bearer token auth, providing tools for searching, creating, and linking records.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQALL_API_KEY` | (required) | API key for Reqall |
| `REQALL_URL` | `https://reqall.net` | Reqall server URL |
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
