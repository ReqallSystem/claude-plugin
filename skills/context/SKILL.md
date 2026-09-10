---
name: context
description: Initialize project and gather relevant context from the Reqall knowledgebase
when_to_use: At session start or before beginning a task, to load project memory — triggered automatically by the SessionStart hook
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__search
  - mcp__plugin_reqall_reqall__list_records
  - mcp__plugin_reqall_reqall__get_record
  - mcp__plugin_reqall_reqall__impact
  - mcp__plugin_reqall_reqall__subscribe_project
  - mcp__plugin_reqall_reqall__poll_subscriptions
  - mcp__plugin_reqall_reqall__list_subscriptions
  - mcp__plugin_reqall_reqall__list_links
  - mcp__Reqall__upsert_project
  - mcp__Reqall__search
  - mcp__Reqall__list_records
  - mcp__Reqall__get_record
  - mcp__Reqall__impact
  - mcp__Reqall__subscribe_project
  - mcp__Reqall__poll_subscriptions
  - mcp__Reqall__list_subscriptions
  - mcp__Reqall__list_links
---

# Gather Context

Load project context from Reqall before starting work.

## Steps

1. **Identify the project** — Use the project name provided by the hook
   output (look for `project_name=...` in the hook message). If no hook
   output is available, check the `REQALL_PROJECT_NAME` env var, then run
   `git remote get-url origin` to extract the `org/repo` name. If the git
   command fails (not a repo), use the machine project
   `.machine/<hostname>/<os-user>` shown in the hook output — never the
   directory basename.

2. **Ensure the project exists** — Call `reqall:upsert_project` with the
   project name. Note the returned `project_id`.

3. **Search for relevant context** — Call `reqall:search` with a natural
   language query derived from the user's prompt or task description. Use
   the project name as the `project_name` parameter to prioritize results
   from the current project.

4. **List open records** — Call `reqall:list_records` with the `project_id`
   and `status: "open"` to surface active issues, specs, and todos.

5. **Subscribe once** — When the hook message includes a `subscribe_project`
   step (OAuth sessions), call `reqall:subscribe_project` with the
   `project_id` and `subscriber` set to the `session_id` from the hook
   message. Each session keeps its own cursor; a new subscription starts at
   the current head, so nothing is replayed. Skip when the message omits
   the step (already subscribed, or the hook polls on its own with an API
   key). If the tool does not exist, the server predates subscriptions —
   say nothing and continue.

6. **Check impact (if relevant)** — If the task involves changing an
   existing record or component, call `reqall:impact` with the relevant
   entity to show downstream records that may be affected. Skip this step
   for new work or simple questions.

7. **Present context** — Summarize findings concisely:
   - Relevant records from search
   - Open items for this project
   - Impact analysis results (if run)

   Call `reqall:get_record` for full details on any records that look
   particularly relevant.

8. **Hand off to intent (if scope is agreed)** — If the task has agreed
   scope — a plan was accepted, or the user asked for a specific,
   non-trivial change — invoke `reqall:intend` before the first edit so the
   spec/arch record for what is to be exists and is linked. For chores,
   questions, and single-file fixes, skip this.

## When to Skip Steps

- Simple question or chat (no coding task): only run step 3 (search).
- Search returns nothing: say so and proceed — the project may be new.
- No open records: skip step 4 output.

## Subscribed Updates

Each later prompt, the UserPromptSubmit hook either injects
`## Reqall updates since last turn` (API-key mode: the hook polled) or asks
you to call `reqall:poll_subscriptions` with `subscriber=<session_id>` and
the project id (OAuth mode). Events are records changed by other sessions,
teammates, or SLEEP; treat them as background context, fetch with
`reqall:get_record` before relying on one, and skip `actor=self` events for
records this session wrote. `reqall:list_subscriptions` shows pending
counts; during a long task, `poll_subscriptions` again to drain more.

## Automatic Per-File Search

The PreToolUse hook instructs Claude to call `reqall:search` with the file
path before each Write, Edit, or NotebookEdit. This supplements the broad
search done here by surfacing file-specific records (specs, issues,
decisions) at the moment of modification.
