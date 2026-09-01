---
name: persist
description: Classify and persist all work completed in this session to Reqall
when_to_use: At the end of a work session or before context compaction — triggered automatically by the Stop and PreCompact hooks
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__search
  - mcp__plugin_reqall_reqall__list_records
  - mcp__plugin_reqall_reqall__upsert_record
  - mcp__plugin_reqall_reqall__upsert_link
  - mcp__Reqall__upsert_project
  - mcp__Reqall__search
  - mcp__Reqall__list_records
  - mcp__Reqall__upsert_record
  - mcp__Reqall__upsert_link
---

# Persist Work

Classify the work completed in this session and save it to the Reqall
knowledgebase. Create one record per distinct work item — sessions often
produce multiple artifacts worth tracking.

## Classification Table

| Work type                          | kind    | status   |
|------------------------------------|---------|----------|
| Bug fix                            | issue   | resolved |
| New bug discovered (not yet fixed) | issue   | open     |
| Completed task                     | todo    | resolved |
| New task identified (not yet done) | todo    | open     |
| Architectural change or decision   | arch    | resolved |
| New or updated specification       | spec    | open     |
| Test scenario added                | test    | open     |
| Trivial / Q&A / unclassifiable     | --      | skip     |

## Title Conventions

Prefix titles to aid scanning:
- Issues: `BUG:`, `TASK:`, `BLOCKER:`, `QUESTION:`
- Specs: `ARCH:`, `API:`, `AUTH:`, `DATA:`, `UI:`

## Steps

1. **Identify the project** — Use the project name provided by the hook
   output (look for `project_name=...` in the hook message). If no hook
   output is available, check the `REQALL_PROJECT_NAME` env var, then run
   `git remote get-url origin` to extract the `org/repo` name, or, if the git
   command fails (not a repo), the machine project `.machine/<hostname>/<os-user>`
   from the hook output — never the directory basename. Call
   `reqall:upsert_project` with that exact name to get the `project_id`.

   **Routing:** account-wide preferences, conventions, and general knowledge go
   to the `.user` project; machine-specific configuration, environment fixes,
   and system wrangling go to the machine project
   `.machine/<hostname>/<os-user>` (both named in the SessionStart hook
   output). Repo-anchored work stays in the repo project — when in doubt,
   prefer the repo project.

2. **Analyze the session** — Review the conversation to identify all
   distinct work items. Scan each category explicitly:
   - Files created or modified
   - Bugs fixed or discovered
   - Architectural or design decisions made
   - Specs written, changed, or discussed
   - Tests added or updated
   - Tasks identified for future work
   - Plans produced by subagents

   A session may produce multiple records, e.g. a bug fix
   (issue/resolved), a new spec (spec/open), and a follow-up task
   (todo/open).

3. **Create records** — For each non-trivial work item, call
   `reqall:upsert_record` with:
   - `project_id` from step 1
   - `kind` and `status` from the classification table
   - A short, descriptive `title` with the appropriate prefix
   - A `body` summarizing what was done, why, and any relevant context.
     Include enough detail for semantic search to find this later.

4. **Create links** — For each meaningful relationship between records
   (new or existing), call `reqall:upsert_link`:
   - A bug fix `implements` a spec
   - A test `tests` an architecture decision
   - A new task is `related` to or `blocks` an existing record
   - A spec is `parent` of sub-specifications

   Use `reqall:search` to find existing records worth linking to.

5. **Summarize** — Tell the user what was persisted: records
   created/updated, links established.

6. **Verify** — Call `reqall:list_records` with the `project_id` to
   review the records just created or updated. Cross-check against the
   work items identified in step 2. If anything was missed, create it
   now.

## When to Skip

If the session was purely Q&A, informational, or trivial (no code changes,
no decisions made), do not create any records. Say "Nothing to persist."
