#!/usr/bin/env node
/**
 * PostToolUse (Write|Edit|NotebookEdit|Bash): record session activity and
 * prompt incremental documentation.
 * Documentation nudges are throttled via REQALL_DOC_INTERVAL_MIN (default 10)
 * so busy sessions are not spammed.
 */
import { emitContext, intervalEnv, machineProjectName, projectName, readStdin, throttle, touchMarker } from './common.js';

const input = readStdin();
const sessionId = input.session_id ?? 'global';

// The Stop hook uses this marker to pick a persist cadence for the session.
touchMarker(`activity-${sessionId}`);

const interval = intervalEnv('REQALL_DOC_INTERVAL_MIN', 10);

if (throttle(`doc-${sessionId}`, interval)) {
  const name = projectName(input);
  emitContext(
    'PostToolUse',
    `[reqall] Recent tool activity may be worth persisting. When you reach a natural ` +
      `pause, launch the reqall-documenter agent (run_in_background=true) with a concise ` +
      `summary of the work just performed and project_name="${name}". It follows the ` +
      `reqall:document skill and silently skips trivial changes. Routing: ` +
      `machine-specific config/fixes -> "${machineProjectName()}", account-wide ` +
      `preferences/conventions -> ".user", repo work -> the given project_name.`,
  );
}
