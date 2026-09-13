---
name: document
description: Document a single work item by upserting a record and any related links to Reqall
when_to_use: Used by the reqall-documenter background agent to incrementally persist work after tool use; lighter-weight than persist
user-invocable: false
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__search
  - mcp__plugin_reqall_reqall__upsert_record
  - mcp__plugin_reqall_reqall__upsert_link
  - mcp__plugin_reqall_reqall__get_record
  - mcp__plugin_reqall_reqall__list_links
  - mcp__Reqall__upsert_project
  - mcp__Reqall__search
  - mcp__Reqall__upsert_record
  - mcp__Reqall__upsert_link
  - mcp__Reqall__get_record
  - mcp__Reqall__list_links
---

# Document Work Item

Called by a background sub-agent after a tool use to incrementally persist
work as it happens. This is lighter-weight than the full `reqall:persist`
skill — it documents a single tool action rather than an entire session.

## When to Skip

Do **not** create a record if the tool use was:
- A read-only operation (reading files, searching, listing)
- A trivial or failed command (e.g. `ls`, `pwd`, a no-op edit) — a failed
  command is not completed work, though a useful diagnosis of the failure
  may still merit an `issue` or `info` record
- A test run that produced no new findings
- Successful Git bookkeeping — `git add`/`commit`/`push`/`fetch`/`pull` or
  `gh pr create`/`merge` — for work that is already documented; the hooks do
  not count it as activity, and neither should you
- A formatting-only change with no semantic impact

Only document **meaningful** work: file creation, substantive edits,
build/deploy commands, database migrations, configuration changes, etc.

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
| Progress on a larger task (a step, not a standalone deliverable) | work | active |
| Durable reference note: fact, how-to, convention that fits no other kind | info | active |
| Trivial / no-op                    | --      | skip     |
| Git bookkeeping only (commit, push, PR create/merge) | -- | skip |

Most incremental tool activity is **progress**, not a finished deliverable.
Record it as `work` — and prefer updating the session's existing `work`
record (found via search in step 3) over creating one per tool use. Work
records are ephemeral: SLEEP promotes their durable content and deletes the
log. Use `todo/resolved` only for a discrete task that is genuinely complete.

## Title Conventions

Prefix titles to aid scanning:
- Issues: `BUG:`, `TASK:`, `BLOCKER:`
- Specs: `ARCH:`, `API:`, `AUTH:`, `DATA:`, `UI:`
- Features: `FEAT:`, `REFACTOR:`
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

1. **Identify the project** — Route by content: account-wide
   preferences/conventions go to `.user`; machine-specific config/fixes go to
   the `.machine/<hostname>/<os-user>` project named in the hook output; all
   repo-anchored work uses the `project_name` provided in the
   sub-agent prompt. Call `reqall:upsert_project` with that name to get
   the `project_id`.

2. **Evaluate the work** — Look at the tool name and summary provided.
   Decide whether this is worth documenting. If trivial, output
   "Nothing to document." and stop.

3. **Search for existing records** — Call `reqall:search` with a short
   description of the work to find records that may already track this
   item. If an existing record covers this work, update it via
   `reqall:upsert_record` (pass its `record_id`) rather than creating
   a duplicate.

4. **Upsert the record** — Call `reqall:upsert_record` with:
   - `project_id` from step 1
   - `kind` and `status` from the classification table
   - A short, descriptive `title` with the appropriate prefix
   - A `body` summarizing what was done and why. Include file paths,
     command output, or other details useful for future semantic search.
   - `links` (when the tool schema offers it): the relationships from
     step 5, inline on this same call, so the record and its edges land
     together.

5. **Upsert links** — If the search in step 3 found related records,
   connect them — inline via `links` above, or with `reqall:upsert_link`
   when `links` is unavailable:
   - A bug fix `implements` a spec
   - A test `tests` an architecture decision
   - A new task is `related` to or `blocks` an existing record
   - A spec is `parent` of sub-specifications
   - A `work` record `implements` the spec/arch it is progressing toward
     (intent recorded by `reqall:intend`), when one exists

6. **Check results** — the record result and every inline link result
   must be `created` / `existing`. An `error` link means partial
   persistence: repair with `reqall:upsert_link` between the existing
   records; never recreate the record. Confirm with `reqall:list_links`
   when a result was ambiguous.

7. **Summarize** — Output a one-line summary of what was documented,
   naming any link that could not be repaired (or "Nothing to document."
   if skipped). Documenting one item does not reconcile the session: the
   Stop hook still drives `reqall:persist`.
