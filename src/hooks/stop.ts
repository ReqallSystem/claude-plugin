#!/usr/bin/env node
/**
 * Stop: block turn completion to force the persist step, then verify it.
 *
 * First pass (stop_hook_active false): sessions with recorded tool or
 * subagent activity, or written intent, block on REQALL_PERSIST_INTERVAL_MIN
 * (default 30); sessions without any activity marker still block, but only
 * on the longer REQALL_IDLE_PERSIST_INTERVAL_MIN (default 120, 0 disables
 * idle blocks) so chat-only decisions are still captured. Nothing is cleared
 * here — a block is a request, not proof that persist ran.
 *
 * Verification pass (stop_hook_active true, after our own block): the
 * activity marker clears; written intents that reqall-track saw covered by
 * an outcome record's implements/blocks link clear too. Uncovered written
 * intents re-block once more, naming them; after that they stay on file so
 * the next Stop lists them again instead of silently forgetting the work.
 */
import {
  clearMarker,
  fmtIntent,
  intentContext,
  intervalEnv,
  isWritten,
  projectName,
  readIntents,
  readMarker,
  readState,
  readStdin,
  sessionKey,
  throttle,
  updateState,
  writeIntents,
} from './common.js';

const input = readStdin();
const sessionId = sessionKey(input);
const activityKey = `activity-${sessionId}`;
const persistKey = `persist-${sessionId}`;
const intentKey = sessionId;

function block(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

if (!input.stop_hook_active) {
  const name = projectName(input);
  const intents = readIntents(intentKey);
  const reason =
    `[reqall] Before completing this turn, invoke the reqall:persist skill to ` +
    `classify and persist the work done in this session. Use project_name="${name}" ` +
    `when calling reqall:upsert_project. Create a record for each distinct work item ` +
    `and link related records. Successful git add/commit/push or gh pr create/merge ` +
    `is bookkeeping, not work: never create a record solely for it. If the session was ` +
    `purely Q&A, bookkeeping, or trivial, state "Nothing to persist." and finish.` +
    intentContext(intents);

  // Intent written this session is persistable work even without file edits;
  // merely consulting existing specs is not.
  if (readMarker(activityKey) > 0 || intents.some(isWritten)) {
    const interval = intervalEnv('REQALL_PERSIST_INTERVAL_MIN', 30);
    if (throttle(persistKey, interval)) {
      updateState(sessionId, (st) => {
        st.block_at = Date.now();
        st.reblocked = false;
      });
      block(reason);
    }
  } else {
    const idleInterval = intervalEnv('REQALL_IDLE_PERSIST_INTERVAL_MIN', 120);
    if (idleInterval > 0 && throttle(persistKey, idleInterval)) {
      block(reason);
    }
  }
} else {
  const st = readState(sessionId);
  // Only verify a block this hook issued; another Stop hook may have blocked.
  if (st.block_at) {
    clearMarker(activityKey);
    const intents = readIntents(intentKey);
    const reconciled = new Set(st.reconciled ?? []);
    const uncovered = intents.filter((i) => isWritten(i) && !reconciled.has(i.id));
    if (uncovered.length > 0 && !st.reblocked) {
      updateState(sessionId, (s) => (s.reblocked = true));
      const persisted = (st.persisted_at ?? 0) >= st.block_at;
      block(
        `[reqall] Persist ran but no outcome record links to ${uncovered.map(fmtIntent).join('; ')}. ` +
          (persisted
            ? `Add the link inline via upsert_record on the existing work/todo record (id + links: ` +
              `[{target_id: <intent id>, relationship: "implements" | "blocks"}]). `
            : `Upsert the session's work record with links: [{target_id: <intent id>, relationship: "implements"}], ` +
              `or a todo/open gap with relationship "blocks". `) +
          `If genuinely nothing was done toward this intent, say so and finish.`,
      );
    } else {
      // Keep only what is still owed; covered and consulted entries are done.
      writeIntents(intentKey, uncovered);
      updateState(sessionId, (s) => {
        delete s.block_at;
        delete s.reblocked;
        delete s.reconciled;
      });
    }
  }
}
