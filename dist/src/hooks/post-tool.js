#!/usr/bin/env node
/**
 * PostToolUse (Write|Edit|NotebookEdit|Bash): prompt incremental documentation.
 * Throttled via REQALL_DOC_INTERVAL_MIN (default 10) so busy sessions are not spammed.
 */
import { emitContext, intervalEnv, projectName, readStdin, throttle } from './common.js';
const input = readStdin();
const interval = intervalEnv('REQALL_DOC_INTERVAL_MIN', 10);
if (throttle(`doc-${input.session_id ?? 'global'}`, interval)) {
    const name = projectName(input);
    emitContext('PostToolUse', `[reqall] Recent tool activity may be worth persisting. When you reach a natural ` +
        `pause, launch the reqall-documenter agent (run_in_background=true) with a concise ` +
        `summary of the work just performed and project_name="${name}". It follows the ` +
        `reqall:document skill and silently skips trivial changes.`);
}
//# sourceMappingURL=post-tool.js.map