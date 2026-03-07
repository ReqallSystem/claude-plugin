---
name: reqall:context
description: Initialize project and gather relevant context from the Reqall knowledgebase
---

# Gather Context

Load project context from Reqall before starting work.

## Steps

1. **Identify the project** — Use the project name provided by the hook
   output (look for `project_name=...` in the hook message). If no hook
   output is available, check the `REQALL_PROJECT_NAME` env var, then run
   `git remote get-url origin` to extract the `org/repo` name, falling
   back to the directory basename only if the git command fails.

2. **Ensure the project exists** — Call `reqall:upsert_project` with the
   project name. Note the returned `project_id`.

3. **Search for relevant context** — Call `reqall:search` with a natural
   language query derived from the user's prompt or task description. Use
   the project name as the `project_name` parameter to prioritize results
   from the current project.

4. **List open records** — Call `reqall:list_records` with the `project_id`
   and `status: "open"` to surface active issues, specs, and todos.

5. **Check impact (if relevant)** — If the task involves changing an
   existing record or component, call `reqall:impact` with the relevant
   entity to show downstream records that may be affected. Skip this step
   for new work or simple questions.

6. **Present context** — Summarize findings concisely:
   - Relevant records from search
   - Open items for this project
   - Impact analysis results (if run)

   Call `reqall:get_record` for full details on any records that look
   particularly relevant.

## When to Skip Steps

- Simple question or chat (no coding task): only run step 3 (search).
- Search returns nothing: say so and proceed — the project may be new.
- No open records: skip step 4 output.

## Automatic Per-File Search

The PreToolUse hook instructs Claude to call `reqall:search` with the file
path before each Write, Edit, or NotebookEdit. This supplements the broad
search done here by surfacing file-specific records (specs, issues,
decisions) at the moment of modification.
