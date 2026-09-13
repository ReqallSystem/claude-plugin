---
name: intend
description: Record agreed intent (a spec or arch record) and its links in Reqall before starting work
when_to_use: After the user has agreed to an approach — a plan was accepted, or a specific change was requested — and before the first edit. Triggered by the ExitPlanMode and UserPromptSubmit hooks.
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__search
  - mcp__plugin_reqall_reqall__get_record
  - mcp__plugin_reqall_reqall__list_records
  - mcp__plugin_reqall_reqall__impact
  - mcp__plugin_reqall_reqall__upsert_record
  - mcp__plugin_reqall_reqall__upsert_link
  - mcp__plugin_reqall_reqall__list_links
  - mcp__Reqall__upsert_project
  - mcp__Reqall__search
  - mcp__Reqall__get_record
  - mcp__Reqall__list_records
  - mcp__Reqall__impact
  - mcp__Reqall__upsert_record
  - mcp__Reqall__upsert_link
  - mcp__Reqall__list_links
---

# Record Intent

Write down *what is to be* before doing it. A spec (new behavior) or arch
(structural decision) record created here is the yardstick the `persist`
skill later measures the session's work against: fulfilled intent gets a
`work --implements--> spec` link; unfulfilled intent gets a blocking todo.

This is deliberately small: at most two write calls, usually one.

## When to Run

Run only when **both** hold:

1. The work introduces new behavior, a contract, or a structural decision —
   not a chore, a typo, a single-file fix, a question, or chat.
2. The scope is agreed — a plan was accepted (ExitPlanMode), or the user
   confirmed an approach or asked for a specific change.

If either fails, do nothing and say nothing. Over-recording intent creates
spec inflation, which is worse than a missing record.

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

2. **Search first** — Call `reqall:search` with a one-sentence description
   of the intended change, `project_name` set, `kind: "spec"` or `"arch"`
   as appropriate (or omit kind). Call `reqall:get_record` on the best hit
   if the title alone is ambiguous.

3. **Prefer existing over new**
   - An existing spec/arch already describes this intent → call
     `reqall:get_record` on it (required, even if step 2 already showed
     enough: the read registers the record with the intent tracker, so the
     Stop/PreCompact hooks can still name it after compaction). Then
     **update it** via `reqall:upsert_record` (pass its `id`) only if the
     agreed scope adds something; otherwise leave it as is.
   - No match → **create one record**:
     - `kind: "spec"`, `status: "open"` for new or changed behavior.
       Title prefix by area: `SPEC:`, `API:`, `AUTH:`, `DATA:`, `UI:`.
     - `kind: "arch"`, `status: "open"` for a structural decision the work
       will realize. Title prefix `ARCH:`.
     - `body`: what will exist when the work is done, why, the agreed
       approach (the accepted plan summary if there is one), acceptance
       criteria, and explicit non-goals. Write for future semantic search,
       not for this session. Reference the GH issue or ticket if any.
     - `links`: pass the relationships from step 4 **inline on this same
       call** when the tool schema offers `links` — one call creates the
       record and its edges. Fall back to `reqall:upsert_link` only when
       the schema has no `links` field or when linking two records that
       already exist.

4. **Link** — For each related record found in step 2 (inline via `links`
   where possible, else `reqall:upsert_link`):
   - new spec is a `parent` of, or `related` to, an existing broader spec
   - new spec `implements` an existing arch decision
   - existing open issue/todo is `related` to the intent it motivated
   - if the task changes tracked behavior, call `reqall:impact` on the
     existing record and link anything downstream that this work touches
     as `related`

5. **Check the link results** — every inline link reports `created`,
   `existing`, or `error`. An `error` is partial persistence: repair it
   with `reqall:upsert_link` between the two existing records; do not
   re-upsert the spec without its `id`, and never create it twice. Confirm
   with `reqall:list_links` when the result was ambiguous.

6. **Report in one line** — "Intent: #<id> <kind> <title> (created|updated|
   existing), linked to #a, #b." Then start the work.

The PostToolUse hook records the ids of spec/arch records written or read
here, so the Stop and PreCompact hooks can hand them to `persist` for
reconciliation. Nothing further is required from this skill.

## Do Not

- Make a separate `upsert_link` call for a link you could have passed
  inline on the `upsert_record` call — the second call is the one that
  gets skipped, and an unlinked spec is invisible to `impact`.
- Create a record for work that has no agreed scope yet — ask, or wait for
  the plan to be accepted.
- Create more than one spec/arch per task. Sub-scopes belong in the body.
- Create `work`, `todo`, or `issue` records here — those are outcomes,
  which `persist` and `document` handle.
- Duplicate an existing spec because its wording differs. Update or link.
