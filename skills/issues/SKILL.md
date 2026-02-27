---
name: reqall:issues
description: Create, list, search, and update issues tracked in Reqall
---

# Issue Tracking

Track and manage issues using the Reqall knowledgebase. Issues represent bugs, tasks, blockers, and problems within projects.

## Conventions

Use title prefixes to categorize issues:
- `BUG:` — Defects to fix
- `TASK:` — Work items
- `BLOCKER:` — Critical blockers
- `QUESTION:` — Unknowns to resolve

## Workflows

### Create an issue
```
reqall:upsert_record { kind: "issue", title: "BUG: ...", body: "...", status: "open" }
```

### List open issues
```
reqall:list_records { kind: "issue", status: "open" }
```

### Search for issues
```
reqall:search { query: "...", kind: "issue" }
```

### Resolve an issue
```
reqall:upsert_record { id: <issue_id>, status: "resolved" }
```

### Link related issues
```
reqall:upsert_link { source_id: <id>, source_table: "records", target_id: <id>, target_table: "records", relationship: "blocks" }
```

## Related Skills
- `reqall:review-issues` — Interactive issue grooming session
- `reqall:specs` — Document requirements and architecture decisions
