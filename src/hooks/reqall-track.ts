#!/usr/bin/env node
/**
 * PostToolUse (reqall upsert_record | get_record | upsert_link |
 * upsert_project | subscribe_project | poll_subscriptions): side-effect-only
 * bookkeeping for the other hooks. Prints nothing.
 *
 * - upsert_record of a spec/arch → `written` intent; get_record of one →
 *   `consulted` intent (the intend skill reads the record it selects, so
 *   intent survives compaction even when nothing needed updating).
 * - every upsert_record id → written_ids, so subscription polls can drop
 *   this session's own writes; an outcome (non-intent) record whose inline
 *   links implement/block a tracked intent marks that intent reconciled,
 *   which is what lets the Stop hook's verification pass clear it.
 * - upsert_link that implements/blocks a tracked intent (the persist skill's
 *   repair for a failed inline link) reconciles it the same way.
 * - upsert_project → project_id / project_name for later polls.
 * - subscribe_project → subscribed_project_id (and the name it was bound
 *   under, when the id matches the last upserted project), so
 *   UserPromptSubmit knows the model already subscribed and can ask it to
 *   poll, or to rebind after the session's project changes.
 * - poll_subscriptions by the model → own-write ids whose actor=self events
 *   were delivered are retired, so a later same-account edit still shows.
 *
 * The MCP tool response reaches hooks either as a content-block array
 * ([{type:'text', text:'{...}'}]) or as a parsed object, so the record is
 * located by walking every string/object in the payload.
 */
import {
  appendIntent,
  consumedOwnIds,
  isIntentKind,
  parseProjectId,
  readIntents,
  readState,
  readStdin,
  retireOwnIds,
  sessionKey,
  updateState,
} from './common.js';

interface FoundRecord {
  id?: number;
  kind?: string;
  title?: string;
  action?: string;
  ok?: boolean;
  project?: { id?: unknown; name?: unknown };
  subscription?: { project_id?: unknown };
  /** A poll_subscriptions payload ({results: [...]}) when present. */
  poll?: unknown;
  /** Successful inline links: intent ids targeted by implements/blocks. */
  linked: number[];
}

function walk(value: unknown, found: FoundRecord, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        walk(JSON.parse(t), found, depth + 1);
      } catch {
        // not JSON — ignore
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, found, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.ok === 'boolean' && found.ok === undefined) found.ok = obj.ok;
    if (typeof obj.action === 'string' && found.action === undefined) found.action = obj.action;
    const rec = obj.record;
    if (rec && typeof rec === 'object') {
      const r = rec as Record<string, unknown>;
      if (typeof r.id === 'number') found.id = r.id;
      if (typeof r.kind === 'string') found.kind = r.kind;
      if (typeof r.title === 'string') found.title = r.title;
    }
    if (obj.project && typeof obj.project === 'object' && !found.project) found.project = obj.project as FoundRecord['project'];
    if (obj.subscription && typeof obj.subscription === 'object' && !found.subscription) {
      found.subscription = obj.subscription as FoundRecord['subscription'];
    }
    if (Array.isArray(obj.results) && found.poll === undefined) found.poll = obj;
    // Inline link results: {target_id, relationship, action: created|existing|error}
    if (
      typeof obj.target_id === 'number' &&
      (obj.relationship === 'implements' || obj.relationship === 'blocks') &&
      (obj.action === 'created' || obj.action === 'existing' || obj.action === undefined) &&
      !obj.error
    ) {
      found.linked.push(obj.target_id);
    }
    for (const v of Object.values(obj)) walk(v, found, depth + 1);
  }
}

const input = readStdin();
const match = /^mcp__[A-Za-z0-9_]+__(upsert_record|get_record|upsert_link|upsert_project|subscribe_project|poll_subscriptions)$/.exec(input.tool_name ?? '');

if (match) {
  const op = match[1];
  const key = sessionKey(input);
  const toolInput = input.tool_input ?? {};
  const found: FoundRecord = { linked: [] };
  walk(input.tool_response, found);
  const failed = found.ok === false;

  if (op === 'upsert_project' && !failed) {
    const id = parseProjectId({ project: found.project });
    const name = typeof found.project?.name === 'string' ? found.project.name : typeof toolInput.name === 'string' ? toolInput.name : undefined;
    if (id !== undefined) {
      updateState(key, (st) => {
        st.project_id = id;
        if (name) st.project_name = name;
      });
    }
  } else if (op === 'subscribe_project' && !failed) {
    const pid =
      typeof found.subscription?.project_id === 'number'
        ? found.subscription.project_id
        : typeof toolInput.project_id === 'number'
          ? toolInput.project_id
          : undefined;
    if (pid !== undefined) {
      updateState(key, (st) => {
        st.subscribed_project_id = pid;
        // The name is only known when the model just bound this same project.
        st.subscribed_project_name = st.project_id === pid ? st.project_name : undefined;
      });
    }
  } else if (op === 'poll_subscriptions' && !failed) {
    const own = readState(key).written_ids ?? [];
    if (own.length > 0 && found.poll !== undefined) retireOwnIds(key, consumedOwnIds(found.poll, own));
  } else if (op === 'upsert_link' && !failed) {
    // A repaired link is as good as an inline one for reconciliation; the
    // response carries the link, else trust the input on success.
    const rel = toolInput.relationship;
    const fromInput = typeof toolInput.target_id === 'number' && (rel === 'implements' || rel === 'blocks') ? [toolInput.target_id] : [];
    const targets = found.linked.length > 0 ? found.linked : fromInput;
    const intentIds = new Set(readIntents(key).map((i) => i.id));
    const covered = targets.filter((t) => intentIds.has(t));
    if (covered.length > 0) {
      updateState(key, (st) => {
        st.reconciled = [...new Set([...(st.reconciled ?? []), ...covered])];
      });
    }
  } else if (op === 'get_record' || op === 'upsert_record') {
    const via = op === 'get_record' ? 'consulted' : 'written';
    const id = found.id ?? (typeof toolInput.id === 'number' ? toolInput.id : undefined);
    // A read carries no kind in its input; only trust the response for consulted entries.
    const kind = found.kind ?? (via === 'written' ? toolInput.kind : undefined);
    const title = found.title ?? (typeof toolInput.title === 'string' ? toolInput.title : `record ${id}`);

    if (id !== undefined && !failed && isIntentKind(kind)) {
      appendIntent(key, { id, kind, title, action: found.action, via });
    }
    if (via === 'written' && !failed) {
      const intentIds = new Set(readIntents(key).map((i) => i.id));
      const covered = found.linked.filter((t) => intentIds.has(t));
      updateState(key, (st) => {
        if (id !== undefined) st.written_ids = [...new Set([...(st.written_ids ?? []), id])].slice(-200);
        if (!isIntentKind(kind)) {
          st.persisted_at = Date.now();
          if (covered.length > 0) st.reconciled = [...new Set([...(st.reconciled ?? []), ...covered])];
        }
      });
    }
  }
}
