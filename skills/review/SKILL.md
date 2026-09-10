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

## Steps

1. **Identify the project** — Determine the project name and call
   `reqall:upsert_project` to get the `project_id`.

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
