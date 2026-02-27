---
name: reqall:review-specs
description: Interactive specification review and validation session
---

# Specification Review

Walk through all specifications for the current project and validate them interactively.

## Process

1. Fetch all specifications for the current project:
   ```
   reqall:list_records { kind: "spec" }
   ```

2. For each spec, present it to the user and ask:
   - Is this still accurate?
   - Does it need updating based on recent changes?
   - Should it be archived?
   - Are there missing links to implementations or tests?

3. Apply updates as directed:
   ```
   reqall:upsert_record { id: <spec_id>, body: "updated text...", status: "open" }
   ```

4. Summarize changes made during the review session.

## Related Skills
- `reqall:specs` — Create and manage individual specifications
