#!/usr/bin/env node
/**
 * PostToolUse (reqall upsert_record | get_record): remember spec/arch records
 * touched this session so the Stop and PreCompact hooks can ask persist to
 * reconcile the work against them. upsert_record entries are `written`
 * intent; get_record entries are `consulted` — the intend skill reads the
 * existing record it selects, so intent survives compaction even when nothing
 * needed updating. Side-effect only — prints nothing.
 *
 * The MCP tool response reaches hooks either as a content-block array
 * ([{type:'text', text:'{...}'}]) or as a parsed object, so the record is
 * located by walking every string/object in the payload.
 */
import { appendIntent, isIntentKind, readStdin } from './common.js';
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
        for (const v of Object.values(obj))
            walk(v, found, depth + 1);
    }
}
const input = readStdin();
const match = /^mcp__[A-Za-z0-9_]+__(upsert_record|get_record)$/.exec(input.tool_name ?? '');
if (match) {
    const via = match[1] === 'get_record' ? 'consulted' : 'written';
    const toolInput = input.tool_input ?? {};
    const found = {};
    walk(input.tool_response, found);
    const id = found.id ?? (typeof toolInput.id === 'number' ? toolInput.id : undefined);
    // A read carries no kind in its input; only trust the response for consulted entries.
    const kind = found.kind ?? (via === 'written' ? toolInput.kind : undefined);
    const title = found.title ?? (typeof toolInput.title === 'string' ? toolInput.title : `record ${id}`);
    if (id !== undefined && isIntentKind(kind)) {
        appendIntent(`${input.session_id ?? 'global'}`, { id, kind, title, action: found.action, via });
    }
}
//# sourceMappingURL=intent-track.js.map