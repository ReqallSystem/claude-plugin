---
name: reqall:classify
description: Classify and persist work completed in a session to Reqall
---

# Work Classification

Classify the work just completed into exactly one category:

| Work type                          | kind    | status     |
|------------------------------------|---------|------------|
| Bug fix                            | issue   | resolved   |
| Architectural change               | arch    | resolved   |
| New feature request (not yet done) | todo    | open       |
| Completed feature request          | todo    | resolved   |
| New spec or plan                   | spec    | open       |
| Test scenario                      | test    | open       |
| Trivial / Q&A / unclassifiable     | —       | no action  |

## Steps

1. Determine the project name from the current git remote or directory name
2. Call `reqall:upsert_project` with the project name to get/create the project ID
3. If the work is non-trivial, call `reqall:upsert_record` with the appropriate kind, status, a short descriptive title, and summary body
4. If the work created or modified relationships between records, call `reqall:upsert_link`
