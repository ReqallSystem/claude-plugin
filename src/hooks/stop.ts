#!/usr/bin/env node
/**
 * Stop: block turn completion to force the persist step.
 * Guards against loops via stop_hook_active. Sessions with recorded tool or
 * subagent activity block on REQALL_PERSIST_INTERVAL_MIN (default 30);
 * sessions without any activity marker still block, but only on the longer
 * REQALL_IDLE_PERSIST_INTERVAL_MIN (default 120, 0 disables idle blocks) so
 * chat-only decisions are still captured without nagging trivial Q&A.
 */
import {
  clearMarker,
  intervalEnv,
  projectName,
  readMarker,
  readStdin,
  throttle,
} from './common.js';

const input = readStdin();

function block(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

if (!input.stop_hook_active) {
  const sessionId = input.session_id ?? 'global';
  const activityKey = `activity-${sessionId}`;
  const persistKey = `persist-${sessionId}`;
  const name = projectName(input);
  const reason =
    `[reqall] Before completing this turn, invoke the reqall:persist skill to ` +
    `classify and persist the work done in this session. Use project_name="${name}" ` +
    `when calling reqall:upsert_project. Create a record for each distinct work item ` +
    `and link related records. If the session was purely Q&A or trivial, state ` +
    `"Nothing to persist." and finish.`;

  if (readMarker(activityKey) > 0) {
    const interval = intervalEnv('REQALL_PERSIST_INTERVAL_MIN', 30);
    if (throttle(persistKey, interval)) {
      block(reason);
      clearMarker(activityKey);
    }
  } else {
    const idleInterval = intervalEnv('REQALL_IDLE_PERSIST_INTERVAL_MIN', 120);
    if (idleInterval > 0 && throttle(persistKey, idleInterval)) {
      block(reason);
    }
  }
}
