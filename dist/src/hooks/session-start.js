#!/usr/bin/env node
/**
 * SessionStart: bootstrap Reqall project context once per session (and again
 * after compaction, where the subscription already exists and is skipped).
 */
import { apiKey, emitContext, machineProjectName, projectName, readState, readStdin, sessionKey, subscriptionStale } from './common.js';
const input = readStdin();
const sessionId = sessionKey(input);
const name = projectName(input);
const st = readState(sessionId);
// In API-key mode the UserPromptSubmit hook subscribes and polls on its own;
// otherwise the model must create the subscription so later prompts can poll.
// A subscription bound under a different project (the selection changed
// before compaction) is released and replaced rather than kept.
const stale = subscriptionStale(st, name);
const subscribe = apiKey()
    ? ''
    : stale
        ? `(4) unsubscribe_project with project_id=${st.subscribed_project_id} and subscriber="${sessionId}" ` +
            `(bound to "${st.subscribed_project_name}", no longer this session's project), then subscribe_project ` +
            `with the new project_id and subscriber="${sessionId}" so later turns poll the right project. `
        : st.subscribed_project_id !== undefined
            ? ''
            : `(4) subscribe_project with that project_id and subscriber="${sessionId}" so later turns can poll ` +
                `for changes made by other sessions. `;
emitContext('SessionStart', `[reqall] Invoke the reqall:context skill with project_name=${name}: ` +
    `(1) upsert the project using EXACTLY name="${name}", ` +
    `(2) search reqall for context relevant to the user's task, ` +
    `(3) list open records for this project. ` +
    subscribe +
    `Skip impact analysis unless the task changes existing tracked work. ` +
    `Reserved routing: machine-specific config/fixes -> "${machineProjectName()}", ` +
    `account-wide preferences/conventions -> ".user". session_id="${sessionId}".`);
//# sourceMappingURL=session-start.js.map