---
name: sleep
description: Compress project memory — consolidate, split, compact, skip, and crosslink records
disable-model-invocation: true
argument-hint: "[org/repo]"
allowed-tools:
  - mcp__plugin_reqall_reqall__upsert_project
  - mcp__plugin_reqall_reqall__sleep_candidates
  - mcp__plugin_reqall_reqall__sleep_apply
  - mcp__plugin_reqall_reqall__get_record
  - mcp__plugin_reqall_reqall__list_records
  - mcp__plugin_reqall_reqall__list_links
  - mcp__plugin_reqall_reqall__search
  - mcp__plugin_reqall_reqall__upsert_link
  - mcp__Reqall__upsert_project
  - mcp__Reqall__sleep_candidates
  - mcp__Reqall__sleep_apply
  - mcp__Reqall__get_record
  - mcp__Reqall__list_records
  - mcp__Reqall__list_links
  - mcp__Reqall__search
  - mcp__Reqall__upsert_link
---

# SLEEP — compress project memory

**Goal:** Preserve **knowledge** in a **minimal number of short, non-redundant records**.
User invoked sleep → rewrite and delete are expected. Compression is the point.
Knowledge = decisions, outcomes, constraints, IDs, contracts — not session prose.

Ops (fixed names): `consolidate` · `split` · `compact` · `skip` · `crosslink` · `promote` · `discard`

Rate-limited ~once per 24h per project. **Modest progress is success** — do not boil the ocean.

## Decision table

| Signal | Action |
|--------|--------|
| Server cluster of highly similar resolved/archived | **consolidate** → one terse record; **sources deleted** |
| Isolated resolved/archived; durable but verbose/redundant | **compact** |
| Isolated resolved/archived; pure noise (ack, empty, no durable fact) | **skip** |
| Active/open; 2+ clearly separable topics | **split** (original deleted by apply) |
| Active/open; single topic, already clear | leave (no op) |
| Cross-project pair; same concept, discovery-useful | **crosslink** |
| Cross-project pair; superficial token overlap | omit |
| `work_review`: unique durable information after comparison | **promote** → supported durable kind(s); the work log is deleted |
| `work_review`: no unique durable information after comparison | **discard** only after preserving useful relationships |
| Candidate unclear / not obvious | **omit this pass** (not a full-run refuse) |

`promote` / `discard` apply only to `kind: work`. Never emit `work` from
consolidate or split.

Prefer clear, concise records and useful links over perfect coverage. A long but appropriate record can wait for a later sleep.

## WORK review policy

Use host equivalents of the tool names below, and only advertised operations/kinds.
If the required reads or operations are unavailable, omit the candidate this pass.

1. Read each WORK log with `get_record`, paginate incoming/outgoing `list_links`,
   and read linked ARCH/SPEC and other durable records. Use project-scoped `search`
   to find existing intent and knowledge, especially when links are missing.
2. **Alignment is not redundancy.** Preserve unique implementation constraints,
   regression fixes, test evidence, outcomes, and remaining limitations even when
   the work followed its spec. Use `promote` into appropriate durable kinds.
3. **Discard only after comparison shows no unique durable information.** Identify
   the surviving records that cover useful content; a knowledge-free log needs none.
   Preserve useful relationships on durable records before discarding: `discard`
   deletes the log's links too. If coverage or relationship meaning is unclear, omit.
4. Preserve an evidence-backed unresolved deviation as a linked `issue`, separating
   expected behavior, observed behavior, and uncertainty about the cause. The
   implementation or the spec may be wrong. Do not automatically rewrite ARCH/SPEC.
5. **Missing links do not prove new requirements.** Reuse intent found by search.
   Promote a novel fact to `info` (or another fitting durable kind); use `spec` only
   for confirmed requirements, never to turn an unapproved proposal into a decision.
6. **Leave ambiguous cases unchanged.** Preserve historical qualifications: dated
   test results and past PR state are not current deployment/runtime guarantees.
7. Before apply, snapshot source records/links and re-read touched records for drift.
   After apply, inspect every result, read back outputs and surviving links, and
   verify deleted sources return structured not-found. Link a new issue to its
   relevant intent with `upsert_link` if needed, then verify. Repair only confirmed
   missing edges. Never replay a destructive batch after an ambiguous response.

## Session attribution

The SessionStart hook message carries a write-attribution label of the form
`session_id="claude:<session id>"`; it is also present on every later hook
message that can lead to a write, so it survives compaction. Pass it as the
`session_id` argument on `reqall:sleep_apply` when the tool schema lists that
argument — every consolidate, split, promote, and delete event the batch
produces then carries this session's origin, so its own subscription polls can
tell them from another session's. Omit it when the schema has no `session_id`
argument (older server); never send unsupported fields. It is correlation
metadata only: it grants nothing, proves nothing, and is not the subscription
`subscriber` label.

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
2. **Candidates** — `reqall:sleep_candidates` with `project_id`. If rate-limited, report next eligible time and stop.
3. **Summary** — counts: consolidate clusters, compact/skip pool, split, crosslink, work_review. Empty → "No eligible candidates this pass."
4. **Select ops** — decision table and WORK review policy above. Prefer obvious wins; small batch is fine. Bodies: terse, non-redundant.
   - **consolidate** — `kind: "arch"`, `status: "resolved"`; best title; keep knowledge from all members; wording is disposable.
   - **compact** — same id; leaner form.
   - **split** — focused sub-records; kind/status fit each topic (usually match original).
   - **crosslink** — only when useful for discovery.
   - **promote** — preserve unique durable knowledge and evidence; drop the narrative.
   - **discard** — only after the comparison and relationship checks above.
5. **Apply** — one `reqall:sleep_apply` with the batch. No per-op confirmation.
6. **Verify** — inspect every apply result for partial failures; do not retry the whole destructive batch after an ambiguous response.
7. **Report** — consolidated / compacted / split / crosslinked / skipped / promoted / discarded / errors. If candidates were capped: note to run again later.

## Rules

- Knowledge ≠ wording. Prose is disposable; durable facts are not.
- **consolidate always deletes sources** (server). **promote** and **discard** delete the work log. Do not keep originals.
- Do not ask whether rewrite/delete is OK — user ran sleep.
- Unclear candidate → omit; do not invent merges or splits.
- Server authorization does not replace client judgment or record/link readback.
