---
name: persist
description: Classify and persist all work completed in this session to Reqall
when_to_use: At the end of a work session or before context compaction — triggered automatically by the Stop and PreCompact hooks
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__search
  - mcp__plugin_reqall_reqall__list_records
  - mcp__plugin_reqall_reqall__get_record
  - mcp__plugin_reqall_reqall__upsert_record
  - mcp__plugin_reqall_reqall__upsert_link
  - mcp__plugin_reqall_reqall__list_links
  - mcp__Reqall__upsert_project
  - mcp__Reqall__search
  - mcp__Reqall__list_records
  - mcp__Reqall__get_record
  - mcp__Reqall__upsert_record
  - mcp__Reqall__upsert_link
  - mcp__Reqall__list_links
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
| Session progress log: what was done, in what order, against which intent | work | resolved (or `active` if the task continues next session) |
| Durable reference note: fact, how-to, convention that fits no other kind | info | active |
| Trivial / Q&A / unclassifiable     | --      | skip     |

Prefer **one `work` record per session** over a pile of `todo/resolved`
records for finished steps. Work records are ephemeral: SLEEP later promotes
their durable content into spec/arch/info records and deletes the log, so
they are the right place for "what happened" narrative. Reserve `todo` for
things still to do and `issue` for bugs.

## Title Conventions

Prefix titles to aid scanning:
- Issues: `BUG:`, `TASK:`, `BLOCKER:`, `QUESTION:`
- Specs: `ARCH:`, `API:`, `AUTH:`, `DATA:`, `UI:`
- Work logs: `WORK:`

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
   - `links` (when the tool schema offers it): the record's relationships
     from steps 4 and 5, inline — e.g. the `work` record with
     `{target_id: <spec>, relationship: "implements"}`, a gap `todo` with
     `{target_id: <spec>, relationship: "blocks"}`. One call, no separate
     `upsert_link` to forget. Each inline link succeeds or fails on its own
     and the result lists which; use `reqall:upsert_link` only between two
     records that already exist or when `links` is unavailable.

4. **Reconcile intent** — The hook message may list "Intent records
   written this session" (spec/arch records created by `reqall:intend` or
   an accepted plan). If it does not, but you know a spec/arch was written
   or agreed this session, treat it the same way. For each intent record:
   - Call `reqall:get_record` if you need its acceptance criteria. Do not
     resolve intent whose acceptance criteria are unverified, and never
     mark a spec resolved as a substitute for the `implements` link — the
     Stop hook verifies the link, not the status.
   - **Fulfilled** by the session's work → the `work` record `implements`
     the intent record (inline `links` on its upsert, or
     `reqall:upsert_link`), and set the `work` record `status: "resolved"`.
     Leave the spec itself `open` unless the user treats specs as tickets
     to close.
   - **Partly or not fulfilled** → create a `todo`/`open` naming the gap
     (what remains, why it was deferred) with an inline link that `blocks`
     the intent record. Keep the `work` record `active`.
   - **Superseded** (the agreed approach changed mid-session) → update the
     intent record's body to the approach actually taken, and note the
     change in the `work` record. Do not leave a stale spec behind.

5. **Create links** — For each other meaningful relationship between
   records: inline via `links` on the record's own upsert, or
   `reqall:upsert_link` between two records that already exist:
   - A bug fix `implements` a spec
   - A test `tests` an architecture decision
   - A new task is `related` to or `blocks` an existing record
   - A spec is `parent` of sub-specifications

   Use `reqall:search` to find existing records worth linking to.

6. **Summarize** — Tell the user what was persisted: records
   created/updated, links established, intent fulfilled or blocked.

7. **Verify** — Call `reqall:list_records` with the `project_id` to
   review the records just created or updated, and `reqall:list_links` on
   the work record when any inline link result was not `created` /
   `existing`. Cross-check against the work items identified in step 2. If
   anything was missed, create it now. The Stop hook re-blocks once when an
   intent record it tracked has no `implements` / `blocks` link from an
   outcome written this session.

## Inline links and verification

Pass `links` on `upsert_record` (at most 20). Each entry names `target_id`,
`relationship`, and, when it matters, `target_table` (`records` or `projects`)
and `direction` (`outgoing`: this record → target, the default; `incoming`:
target → this record). Use `implements` for outcome → intent, `tests` for
evidence → subject, `blocks` for blocker → blocked item, and `parent` /
`related` only when justified.

Check the record result **and every per-link result**: `action: created` or
`existing` succeeds; `error`, a missing entry, or a count mismatch is partial
persistence even though the record saved. Repair a missing link with
`reqall:upsert_link` (reverse the endpoints for an incoming link) — never
recreate a record that already saved. When in doubt, read back the record
with `reqall:get_record` and its edges with `reqall:list_links` before
reporting success. Report remaining failures rather than treating a
successful transport response as persistence.

## When to Skip

If the session was purely Q&A, informational, or trivial (no code changes,
no decisions made), do not create any records. Say "Nothing to persist."
