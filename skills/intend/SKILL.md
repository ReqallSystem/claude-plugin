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
  - mcp__Reqall__upsert_project
  - mcp__Reqall__search
  - mcp__Reqall__get_record
  - mcp__Reqall__list_records
  - mcp__Reqall__impact
  - mcp__Reqall__upsert_record
  - mcp__Reqall__upsert_link
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

## Steps

1. **Identify the project** — Use `project_name=...` from the hook message
   (else `REQALL_PROJECT_NAME`, else `git remote get-url origin` as
   `org/repo`, else the `.machine/<hostname>/<os-user>` project named in the
   hook output — never the directory basename). Call `reqall:upsert_project`
   with that exact name and note the `project_id`.

2. **Search first** — Call `reqall:search` with a one-sentence description
   of the intended change, `project_name` set, `kind: "spec"` or `"arch"`
   as appropriate (or omit kind). Call `reqall:get_record` on the best hit
   if the title alone is ambiguous.

3. **Prefer existing over new**
   - An existing spec/arch already describes this intent → **update it**
     via `reqall:upsert_record` (pass its `id`) only if the agreed scope adds
     something; otherwise leave it and just note its id for step 5.
   - No match → **create one record**:
     - `kind: "spec"`, `status: "open"` for new or changed behavior.
       Title prefix by area: `SPEC:`, `API:`, `AUTH:`, `DATA:`, `UI:`.
     - `kind: "arch"`, `status: "open"` for a structural decision the work
       will realize. Title prefix `ARCH:`.
     - `body`: what will exist when the work is done, why, the agreed
       approach (the accepted plan summary if there is one), acceptance
       criteria, and explicit non-goals. Write for future semantic search,
       not for this session. Reference the GH issue or ticket if any.

4. **Link** — For each related record found in step 2, call
   `reqall:upsert_link`:
   - new spec is a `parent` of, or `related` to, an existing broader spec
   - new spec `implements` an existing arch decision
   - existing open issue/todo is `related` to the intent it motivated
   - if the task changes tracked behavior, call `reqall:impact` on the
     existing record and link anything downstream that this work touches
     as `related`

5. **Report in one line** — "Intent: #<id> <kind> <title> (created|updated|
   existing), linked to #a, #b." Then start the work.

The PostToolUse hook records the ids of spec/arch records written here, so
the Stop and PreCompact hooks can hand them to `persist` for
reconciliation. Nothing further is required from this skill.

## Do Not

- Create a record for work that has no agreed scope yet — ask, or wait for
  the plan to be accepted.
- Create more than one spec/arch per task. Sub-scopes belong in the body.
- Create `work`, `todo`, or `issue` records here — those are outcomes,
  which `persist` and `document` handle.
- Duplicate an existing spec because its wording differs. Update or link.
