#!/usr/bin/env node
/**
 * PostToolUse (reqall upsert_record | get_record | upsert_project |
 * subscribe_project): side-effect-only bookkeeping for the other hooks.
 * Prints nothing.
 *
 * - upsert_record of a spec/arch → `written` intent; get_record of one →
 *   `consulted` intent (the intend skill reads the record it selects, so
 *   intent survives compaction even when nothing needed updating).
 * - every upsert_record id → written_ids, so subscription polls can drop
 *   this session's own writes; an outcome (non-intent) record whose inline
 *   links implement/block a tracked intent marks that intent reconciled,
 *   which is what lets the Stop hook's verification pass clear it.
 * - upsert_project → project_id / project_name for later polls.
 * - subscribe_project → subscribed_project_id, so UserPromptSubmit knows the
 *   model already subscribed and can ask it to poll.
 *
 * The MCP tool response reaches hooks either as a content-block array
 * ([{type:'text', text:'{...}'}]) or as a parsed object, so the record is
 * located by walking every string/object in the payload.
 */
import { appendIntent, isIntentKind, parseProjectId, readIntents, readStdin, sessionKey, updateState } from './common.js';
function walk(value, found, depth = 0) {
    if (depth > 8 || value === null || value === undefined)
        return;
    if (typeof value === 'string') {
        const t = value.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
            try {
                walk(JSON.parse(t), found, depth + 1);
            }
            catch {
                // not JSON — ignore
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const v of value)
            walk(v, found, depth + 1);
        return;
    }
    if (typeof value === 'object') {
        const obj = value;
        if (typeof obj.ok === 'boolean' && found.ok === undefined)
            found.ok = obj.ok;
        if (typeof obj.action === 'string' && found.action === undefined)
            found.action = obj.action;
        const rec = obj.record;
        if (rec && typeof rec === 'object') {
            const r = rec;
            if (typeof r.id === 'number')
                found.id = r.id;
            if (typeof r.kind === 'string')
                found.kind = r.kind;
            if (typeof r.title === 'string')
                found.title = r.title;
        }
        if (obj.project && typeof obj.project === 'object' && !found.project)
            found.project = obj.project;
        if (obj.subscription && typeof obj.subscription === 'object' && !found.subscription) {
            found.subscription = obj.subscription;
        }
        // Inline link results: {target_id, relationship, action: created|existing|error}
        if (typeof obj.target_id === 'number' &&
            (obj.relationship === 'implements' || obj.relationship === 'blocks') &&
            (obj.action === 'created' || obj.action === 'existing' || obj.action === undefined) &&
            !obj.error) {
            found.linked.push(obj.target_id);
        }
        for (const v of Object.values(obj))
            walk(v, found, depth + 1);
    }
}
const input = readStdin();
const match = /^mcp__[A-Za-z0-9_]+__(upsert_record|get_record|upsert_project|subscribe_project)$/.exec(input.tool_name ?? '');
if (match) {
    const op = match[1];
    const key = sessionKey(input);
    const toolInput = input.tool_input ?? {};
    const found = { linked: [] };
    walk(input.tool_response, found);
    const failed = found.ok === false;
    if (op === 'upsert_project' && !failed) {
        const id = parseProjectId({ project: found.project });
        const name = typeof found.project?.name === 'string' ? found.project.name : typeof toolInput.name === 'string' ? toolInput.name : undefined;
        if (id !== undefined) {
            updateState(key, (st) => {
                st.project_id = id;
                if (name)
                    st.project_name = name;
            });
        }
    }
    else if (op === 'subscribe_project' && !failed) {
        const pid = typeof found.subscription?.project_id === 'number'
            ? found.subscription.project_id
            : typeof toolInput.project_id === 'number'
                ? toolInput.project_id
                : undefined;
        if (pid !== undefined)
            updateState(key, (st) => (st.subscribed_project_id = pid));
    }
    else if (op === 'get_record' || op === 'upsert_record') {
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
                if (id !== undefined)
                    st.written_ids = [...new Set([...(st.written_ids ?? []), id])].slice(-200);
                if (!isIntentKind(kind)) {
                    st.persisted_at = Date.now();
                    if (covered.length > 0)
                        st.reconciled = [...new Set([...(st.reconciled ?? []), ...covered])];
                }
            });
        }
    }
}
//# sourceMappingURL=reqall-track.js.map