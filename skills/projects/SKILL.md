---
name: reqall:projects
description: List projects, view records by project, manage project context
---

# Project Management

Explore and manage projects in the Reqall knowledgebase.

## Workflows

### List all projects
```
reqall:list_projects
```

### View records for a project
```
reqall:list_records { project_id: <project_id> }
```

### Create a new project
```
reqall:upsert_project { name: "org/repo" }
```

### Search across projects
```
reqall:search { query: "..." }
```

### View project impact graph
```
reqall:impact { entity_id: <project_id>, entity_type: "projects" }
```

## Related Skills
- `reqall:issues` — Track bugs, tasks, and blockers
- `reqall:specs` — Document requirements and architecture decisions
