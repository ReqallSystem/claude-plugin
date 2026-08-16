#!/usr/bin/env node
/**
 * SubagentStop: record session activity so the Stop hook uses the active
 * persist cadence — subagent output (plans, findings) is persistable work.
 *
 * Side-effect only: per current hook docs, SubagentStop JSON output cannot
 * inject context into the parent conversation, so this hook prints nothing.
 */
import { readStdin, touchMarker } from './common.js';
const input = readStdin();
touchMarker(`activity-${input.session_id ?? 'global'}`);
//# sourceMappingURL=subagent-stop.js.map