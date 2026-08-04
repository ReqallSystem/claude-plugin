#!/usr/bin/env node
/** PreCompact: persist important state before context is compacted away. */
import { emitContext, projectName, readStdin } from './common.js';

const input = readStdin();
const name = projectName(input);

emitContext(
  'PreCompact',
  `[reqall] Context is about to be compacted. Before details are lost, persist any ` +
    `unrecorded decisions, issues, or completed work to Reqall via the reqall:persist ` +
    `skill using project_name="${name}". Skip if everything is already recorded.`,
);
