---
name: reqall:review-issues
description: Interactive issue review and grooming session
---

# Issue Review

Walk through all open issues for the current project and triage them interactively.

## Process

1. Fetch all open issues for the current project:
   ```
   reqall:list_records { kind: "issue", status: "open" }
   ```

2. For each issue, present it to the user and ask:
   - Is this still relevant?
   - Should the status change (resolve, archive)?
   - Does it need more detail or context?
   - Are there related issues to link?

3. Apply updates as directed:
   ```
   reqall:upsert_record { id: <issue_id>, status: "resolved" }
   ```

4. Summarize changes made during the review session.

## Related Skills
- `reqall:issues` — Create and manage individual issues
