#!/usr/bin/env node
/**
 * PostToolUse (ExitPlanMode): an accepted plan is agreed intent. Instruct the
 * model to record it as a spec/arch record via reqall:intend before starting
 * the work. Not throttled — plan acceptance is rare and always meaningful.
 */
import { emitContext, projectName, readStdin, touchMarker } from './common.js';

const input = readStdin();

if (input.tool_name === 'ExitPlanMode') {
  const sessionId = input.session_id ?? 'global';
  touchMarker(`activity-${sessionId}`);
  const name = projectName(input);
  emitContext(
    'PostToolUse',
    `[reqall] A plan was just accepted — that is agreed intent. Before starting the work, ` +
      `invoke the reqall:intend skill with project_name="${name}": search for an existing ` +
      `spec/arch that covers the plan and update/link it, otherwise upsert ONE record ` +
      `(kind spec for new behavior, arch for a structural decision) whose body is the plan ` +
      `summary, then link it to the related records found. Then proceed with the plan.`,
  );
}
