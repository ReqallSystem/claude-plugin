#!/usr/bin/env node
/**
 * SessionEnd: release the hook-owned subscription cursor (API-key mode only —
 * a subscription the model created via OAuth cannot be reached from here and
 * is left for the server to expire) and delete the session's state files so
 * CLAUDE_PLUGIN_DATA does not accumulate one set per session forever.
 * Output is ignored by Claude Code, so this prints nothing.
 */
import { apiKey, cleanupSession, mcpCall, readState, readStdin, sessionKey } from './common.js';

const input = readStdin();
const sessionId = sessionKey(input);

async function main(): Promise<void> {
  const st = readState(sessionId);
  if (apiKey() && st.subscribed_by_hook && st.subscribed_project_id !== undefined) {
    await mcpCall('unsubscribe_project', { project_id: st.subscribed_project_id, subscriber: sessionId }, 4000);
  }
  cleanupSession(sessionId);
}

void main();
