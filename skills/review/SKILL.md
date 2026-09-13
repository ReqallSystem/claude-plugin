---
name: review
description: Interactive review and triage of open records for the current project
disable-model-invocation: true
argument-hint: "[kind]"
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__list_records
  - mcp__plugin_reqall_reqall__get_record
  - mcp__plugin_reqall_reqall__upsert_record
  - mcp__plugin_reqall_reqall__upsert_link
  - mcp__plugin_reqall_reqall__list_links
  - mcp__Reqall__upsert_project
  - mcp__Reqall__list_records
  - mcp__Reqall__get_record
  - mcp__Reqall__upsert_record
  - mcp__Reqall__upsert_link
  - mcp__Reqall__list_links
---

# Review Open Records

Walk through open records for the current project and triage them
interactively with the user.

## Session attribution

The hook message carries a write-attribution label of the form
`session_id="claude:<session id>"`. Pass it as the `session_id` argument on
every Reqall write tool call whose schema lists that argument —
`upsert_record`, `upsert_link`, `delete_record`, `delete_link`, `sleep_apply`,
`merge_projects`, and inline `links` ride along with their `upsert_record`.
Omit it when the tool schema has no `session_id` argument (older server); never
send unsupported fields. It is correlation metadata so subscription polls can
tell this session's writes from another session of the same account: it grants
nothing, proves nothing, and is not the subscription `subscriber` label.

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

2. **Fetch open records** — Call `reqall:list_records` with `project_id`
   and `status: "open"`. If the user specified a kind filter (e.g.
   "review my issues"), add `kind` accordingly. Otherwise fetch all kinds.
   Follow pagination before claiming every record was reviewed.

3. **Present each record** — For each open record, show its kind, title,
   and status. Call `reqall:get_record` for the full body if needed.
   Ask the user:
   - Is this still relevant?
   - Should the status change? (resolve, archive)
   - Does it need more detail or updates?
   - Are there related records to link?

4. **Apply updates** — Based on user responses:
   - `reqall:upsert_record` with the record's `id` and only the changed
     fields; pass new relationships inline via `links` on that same call
   - `reqall:upsert_link` only for a new relationship between two records
     that are otherwise unchanged
   - `reqall:delete_record` only if explicitly requested
   - a status change is not implementation evidence: do not resolve a spec
     or arch record because the user says the work is done — that belongs
     to an outcome record that `implements` it

5. **Verify and summarize** — Check each record and link result
   (`created` / `existing` succeed; `error` is a partial failure to repair
   with `reqall:upsert_link`, never by recreating the record). Report what
   changed: records updated, resolved, archived, and links created,
   separately from anything that failed.
