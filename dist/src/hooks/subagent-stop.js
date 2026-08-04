#!/usr/bin/env node
/** SubagentStop: save Plan output as a spec; note other agents' work for persistence. */
import { emitContext, projectName, readStdin } from './common.js';
const input = readStdin();
const name = projectName(input);
if (input.agent_type === 'Plan') {
    emitContext('SubagentStop', `[reqall] A planning subagent completed. Save its plan as a spec record: call ` +
        `reqall:upsert_project with name="${name}", then reqall:upsert_record with ` +
        `kind=spec, status=open, the plan title, and the full plan as body.`);
}
else {
    emitContext('SubagentStop', `[reqall] A subagent completed. If it produced significant work products (code ` +
        `changes, findings, decisions), note them so they are included when work is ` +
        `persisted at session end.`);
}
//# sourceMappingURL=subagent-stop.js.map