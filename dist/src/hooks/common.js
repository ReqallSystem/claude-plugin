/**
 * Shared helpers for Reqall hook scripts.
 *
 * Hooks receive a JSON payload on stdin and communicate back to Claude Code
 * by printing a JSON object to stdout (exit code 0). Printing nothing means
 * "no action". See https://code.claude.com/docs/en/hooks
 */
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
/** REQALL_PROJECT_NAME > git remote org/repo > cwd basename. */
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
    return basename(cwd);
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
//# sourceMappingURL=common.js.map