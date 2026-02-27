---
name: reqall:specs
description: Document requirements and architecture decisions in Reqall
---

# Specification Management

Document requirements, architecture decisions, API contracts, and design patterns using Reqall.

## Conventions

Use title prefixes to categorize specifications:
- `ARCH:` — Architecture decisions
- `API:` — API contracts
- `AUTH:` — Authentication/authorization
- `DATA:` — Data models/schemas
- `UI:` — User interface patterns

## Workflows

### Create a specification
```
reqall:upsert_record { kind: "spec", title: "ARCH: ...", body: "...", status: "open" }
```

### List specifications
```
reqall:list_records { kind: "spec" }
```

### Search for specs
```
reqall:search { query: "...", kind: "spec" }
```

### Link a spec to its implementation
```
reqall:upsert_link { source_id: <spec_id>, source_table: "records", target_id: <impl_id>, target_table: "records", relationship: "implements" }
```

## Related Skills
- `reqall:review-specs` — Interactive spec review and validation session
- `reqall:issues` — Track bugs, tasks, and blockers
