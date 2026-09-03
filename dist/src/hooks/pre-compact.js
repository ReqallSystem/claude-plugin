#!/usr/bin/env node
/** PreCompact: persist important state before context is compacted away. */
import { emitContext, intentContext, projectName, readIntents, readStdin } from './common.js';
const input = readStdin();
const name = projectName(input);
const intents = readIntents(`${input.session_id ?? 'global'}`);
emitContext('PreCompact', `[reqall] Context is about to be compacted. Before details are lost, persist any ` +
    `unrecorded decisions, issues, or completed work to Reqall via the reqall:persist ` +
    `skill using project_name="${name}". Skip if everything is already recorded.` +
    intentContext(intents));
//# sourceMappingURL=pre-compact.js.map