#!/usr/bin/env node
/** SessionStart: bootstrap Reqall project context once per session. */
import { emitContext, machineProjectName, projectName, readStdin } from './common.js';
const input = readStdin();
const name = projectName(input);
emitContext('SessionStart', `[reqall] Invoke the reqall:context skill with project_name=${name}: ` +
    `(1) upsert the project using EXACTLY name="${name}", ` +
    `(2) search reqall for context relevant to the user's task, ` +
    `(3) list open records for this project. ` +
    `Skip impact analysis unless the task changes existing tracked work. ` +
    `Reserved routing: machine-specific config/fixes -> "${machineProjectName()}", ` +
    `account-wide preferences/conventions -> ".user".`);
//# sourceMappingURL=session-start.js.map