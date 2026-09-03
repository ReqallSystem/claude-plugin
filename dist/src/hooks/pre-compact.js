#!/usr/bin/env node
/**
 * PreCompact: persist important state before context is compacted away.
 * Intent records are handed to persist here and then marked handed_off (not
 * cleared — this output is advisory) so the later Stop hook asks for
 * verification instead of a second reconciliation.
 */
import { emitContext, intentContext, markIntentsHandedOff, projectName, readIntents, readStdin } from './common.js';
const input = readStdin();
const name = projectName(input);
const intentKey = `${input.session_id ?? 'global'}`;
const intents = readIntents(intentKey);
emitContext('PreCompact', `[reqall] Context is about to be compacted. Before details are lost, persist any ` +
    `unrecorded decisions, issues, or completed work to Reqall via the reqall:persist ` +
    `skill using project_name="${name}". Skip if everything is already recorded.` +
    intentContext(intents));
markIntentsHandedOff(intentKey);
//# sourceMappingURL=pre-compact.js.map