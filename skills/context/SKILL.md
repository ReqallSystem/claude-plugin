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

## Steps

1. **Identify the project** — Use the Project identity policy above, preserving
   an explicit operation argument or authoritative hook binding. Call
   `reqall:upsert_project` with that exact name to get the `project_id`.

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
