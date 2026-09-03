/**
 * Shared helpers for Reqall hook scripts.
 *
 * Hooks receive a JSON payload on stdin and communicate back to Claude Code
 * by printing a JSON object to stdout (exit code 0). Printing nothing means
 * "no action". See https://code.claude.com/docs/en/hooks
 */
import { execFileSync } from 'node:child_process';
import { hostname as osHostname, userInfo } from 'node:os';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function readStdin() {
    try {
        const raw = readFileSync(0, 'utf-8').trim();
        return raw ? JSON.parse(raw) : {};
    }
    catch {
        return {};
    }
}
/**
 * The reserved machine project for this box and OS user:
 * `.machine/<hostname>/<os-user>`. REQALL_MACHINE_NAME overrides the hostname
 * segment — set it in CI/containers where hostnames are ephemeral, so runs
 * don't mint a fresh project each time. The server auto-creates `.user` and
 * links it parent→ this project on first upsert.
 */
export function machineProjectName() {
    const clean = (seg) => seg.trim().replace(/[\\/\s]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
    const host = process.env.REQALL_MACHINE_NAME?.trim() || osHostname().split('.')[0];
    let user = 'unknown';
    try {
        user = userInfo().username || 'unknown';
    }
    catch {
        // userInfo can throw on exotic environments (no passwd entry)
    }
    return `.machine/${clean(host).toLowerCase()}/${clean(user)}`;
}
/** REQALL_PROJECT_NAME > git remote org/repo > machine project (never the cwd basename). */
export function projectName(input) {
    const env = process.env.REQALL_PROJECT_NAME;
    if (env)
        return env;
    const cwd = input.cwd || process.cwd();
    try {
        const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const match = url.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
        if (match)
            return match[1];
    }
    catch {
        // not a git repo or git unavailable — fall through
    }
    // Sessions outside any repo are machine memory, not a project named after
    // whatever directory we happen to be in (which minted junk like "dev",
    // "Work", or UUID worktree names).
    return machineProjectName();
}
/** Emit additionalContext for the given event and exit 0. */
export function emitContext(eventName, context) {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: eventName,
            additionalContext: context,
        },
    }));
}
function stateDir() {
    return (process.env.CLAUDE_PLUGIN_DATA ||
        join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'reqall-plugin'));
}
function stateFile(prefix, key) {
    return join(stateDir(), `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
}
/**
 * Rate limiter backed by CLAUDE_PLUGIN_DATA (falls back to tmpdir).
 * Returns true when the action is allowed and records the attempt.
 * intervalMin <= 0 disables throttling.
 */
export function throttle(key, intervalMin) {
    if (intervalMin <= 0)
        return true;
    try {
        mkdirSync(stateDir(), { recursive: true });
        const file = stateFile('throttle', key);
        const now = Date.now();
        if (existsSync(file)) {
            const last = Number(readFileSync(file, 'utf-8'));
            if (Number.isFinite(last) && now - last < intervalMin * 60_000)
                return false;
        }
        writeFileSync(file, String(now));
        return true;
    }
    catch {
        return true; // never let bookkeeping failures suppress the hook
    }
}
/** Record that the session performed persistable work. */
export function touchMarker(key) {
    try {
        mkdirSync(stateDir(), { recursive: true });
        writeFileSync(stateFile('marker', key), String(Date.now()));
    }
    catch {
        // best-effort bookkeeping
    }
}
/** Timestamp of a marker, or 0 when absent/unreadable. */
export function readMarker(key) {
    try {
        const n = Number(readFileSync(stateFile('marker', key), 'utf-8'));
        return Number.isFinite(n) ? n : 0;
    }
    catch {
        return 0;
    }
}
/** Remove a marker once its work has been handled. */
export function clearMarker(key) {
    try {
        rmSync(stateFile('marker', key), { force: true });
    }
    catch {
        // best-effort bookkeeping
    }
}
export function intervalEnv(name, defaultMin) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return defaultMin;
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultMin;
}
const INTENT_KINDS = new Set(['spec', 'arch']);
const MAX_CONSULTED = 8;
/** Kinds whose upserts count as intent (what the work is supposed to satisfy). */
export function isIntentKind(kind) {
    return typeof kind === 'string' && INTENT_KINDS.has(kind);
}
export function isWritten(e) {
    return e.via !== 'consulted';
}
/** Append an intent record to the session's JSONL intent file. */
export function appendIntent(key, entry) {
    try {
        mkdirSync(stateDir(), { recursive: true });
        appendFileSync(stateFile('intent', key), JSON.stringify(entry) + '\n');
    }
    catch {
        // best-effort bookkeeping
    }
}
/**
 * Intent records for the session, merged by id in file order: a write is
 * sticky over a read, a later write clears a hand-off mark, and the newest
 * title wins. Consulted-only entries are capped to the most recent few.
 */
export function readIntents(key) {
    try {
        const byId = new Map();
        for (const line of readFileSync(stateFile('intent', key), 'utf-8').split('\n')) {
            if (!line.trim())
                continue;
            let e;
            try {
                e = JSON.parse(line);
            }
            catch {
                continue; // skip malformed line
            }
            if (typeof e.id !== 'number')
                continue;
            const prev = byId.get(e.id);
            byId.delete(e.id); // re-insert so map order reflects most recent touch
            if (!prev) {
                byId.set(e.id, e);
                continue;
            }
            const written = isWritten(prev) || isWritten(e);
            byId.set(e.id, {
                id: e.id,
                kind: e.kind || prev.kind,
                title: e.title || prev.title,
                action: e.action ?? prev.action,
                via: written ? 'written' : 'consulted',
                handed_off: isWritten(e) && !e.handed_off ? false : (e.handed_off ?? prev.handed_off ?? false),
            });
        }
        const all = [...byId.values()];
        const writtenOnes = all.filter(isWritten);
        const consulted = all.filter((e) => !isWritten(e)).slice(-MAX_CONSULTED);
        return [...writtenOnes, ...consulted];
    }
    catch {
        return [];
    }
}
/** Rewrite the session's intent file with every entry marked as handed off to persist. */
export function markIntentsHandedOff(key) {
    try {
        const intents = readIntents(key);
        if (intents.length === 0)
            return;
        mkdirSync(stateDir(), { recursive: true });
        writeFileSync(stateFile('intent', key), intents.map((e) => JSON.stringify({ ...e, handed_off: true })).join('\n') + '\n');
    }
    catch {
        // best-effort bookkeeping
    }
}
/** Remove the session's intent file once the work has been reconciled. */
export function clearIntents(key) {
    try {
        rmSync(stateFile('intent', key), { force: true });
    }
    catch {
        // best-effort bookkeeping
    }
}
function fmtIntent(i) {
    return `#${i.id} ${i.kind} "${i.title.replace(/"/g, "'")}"`;
}
/**
 * Human-readable reconciliation instructions for the persist step, or '' when
 * the session touched no intent. Shared by the Stop and PreCompact hooks.
 */
export function intentContext(intents) {
    if (intents.length === 0)
        return '';
    const fresh = intents.filter((i) => isWritten(i) && !i.handed_off);
    const handedOff = intents.filter((i) => isWritten(i) && i.handed_off);
    const consulted = intents.filter((i) => !isWritten(i));
    const parts = [];
    if (fresh.length > 0) {
        parts.push(`Intent records written this session: ${fresh.map(fmtIntent).join('; ')}. ` +
            `Reconcile the work against them: upsert one \`work\` record summarizing what was done, ` +
            `passing its links inline on that same upsert_record call — for each intent the work ` +
            `fulfills, links: [{target_id: <intent id>, relationship: "implements"}] and status resolved; ` +
            `for each intent not (fully) fulfilled, upsert a todo/open describing the gap with ` +
            `links: [{target_id: <intent id>, relationship: "blocks"}]. Do not make a separate ` +
            `upsert_link call for a link that can go inline.`);
    }
    if (handedOff.length > 0) {
        parts.push(`Intent records already handed to persist before compaction: ${handedOff.map(fmtIntent).join('; ')}. ` +
            `Verify their reconciliation exists (work --implements--> intent, or todo --blocks--> intent) and ` +
            `update the existing work record for this session; do NOT create a second work record or ` +
            `duplicate todos. If a link is missing, add it inline via links on the existing record's ` +
            `upsert_record (id + links), not a separate upsert_link call.`);
    }
    if (consulted.length > 0) {
        parts.push(`Existing spec/arch records consulted this session: ${consulted.map(fmtIntent).join('; ')}. ` +
            `If one of these was the agreed intent for the work, reconcile against it the same way.`);
    }
    return ' ' + parts.join(' ');
}
//# sourceMappingURL=common.js.map