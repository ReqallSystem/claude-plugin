#!/usr/bin/env node
/**
 * Stop: block turn completion once to force the persist step.
 * Guards against loops via stop_hook_active and throttles repeat blocks with
 * REQALL_PERSIST_INTERVAL_MIN (default 30) per session.
 */
import { intervalEnv, projectName, readStdin, throttle } from './common.js';

const input = readStdin();

if (!input.stop_hook_active) {
  const interval = intervalEnv('REQALL_PERSIST_INTERVAL_MIN', 30);
  if (throttle(`persist-${input.session_id ?? 'global'}`, interval)) {
    const name = projectName(input);
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          `[reqall] Before completing this turn, invoke the reqall:persist skill to ` +
          `classify and persist the work done in this session. Use project_name="${name}" ` +
          `when calling reqall:upsert_project. Create a record for each distinct work item ` +
          `and link related records. If the session was purely Q&A or trivial, state ` +
          `"Nothing to persist." and finish.`,
      }),
    );
  }
}
