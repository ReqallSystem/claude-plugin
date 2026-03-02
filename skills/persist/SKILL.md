---
name: reqall:persist
description: Classify and persist all work completed in this session to Reqall
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

1. **Identify the project** — Determine the project name from the git
   remote or directory. Call `reqall:upsert_project` to get the
   `project_id`.

2. **Analyze the session** — Review the conversation to identify all
   distinct work items. A session may produce multiple records, e.g. a
   bug fix (issue/resolved), a new spec (spec/open), and a follow-up
   task (todo/open).

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

## When to Skip

If the session was purely Q&A, informational, or trivial (no code changes,
no decisions made), do not create any records. Say "Nothing to persist."
