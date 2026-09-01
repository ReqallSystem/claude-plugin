/**
 * Shared helpers for Reqall hook scripts.
 *
 * Hooks receive a JSON payload on stdin and communicate back to Claude Code
 * by printing a JSON object to stdout (exit code 0). Printing nothing means
 * "no action". See https://code.claude.com/docs/en/hooks
 */
import { execFileSync } from 'node:child_process';
import { hostname as osHostname, userInfo } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_id?: string;
  agent_type?: string;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

export function readStdin(): HookInput {
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    return raw ? (JSON.parse(raw) as HookInput) : {};
  } catch {
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
export function machineProjectName(): string {
  const clean = (seg: string) => seg.trim().replace(/[\\/\s]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  const host = process.env.REQALL_MACHINE_NAME?.trim() || osHostname().split('.')[0];
  let user = 'unknown';
  try {
    user = userInfo().username || 'unknown';
  } catch {
    // userInfo can throw on exotic environments (no passwd entry)
  }
  return `.machine/${clean(host).toLowerCase()}/${clean(user)}`;
}

/** REQALL_PROJECT_NAME > git remote org/repo > machine project (never the cwd basename). */
export function projectName(input: HookInput): string {
  const env = process.env.REQALL_PROJECT_NAME;
  if (env) return env;
  const cwd = input.cwd || process.cwd();
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = url.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
    if (match) return match[1];
  } catch {
    // not a git repo or git unavailable — fall through
  }
  // Sessions outside any repo are machine memory, not a project named after
  // whatever directory we happen to be in (which minted junk like "dev",
  // "Work", or UUID worktree names).
  return machineProjectName();
}

/** Emit additionalContext for the given event and exit 0. */
export function emitContext(eventName: string, context: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: context,
      },
    }),
  );
}

function stateDir(): string {
  return (
    process.env.CLAUDE_PLUGIN_DATA ||
    join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'reqall-plugin')
  );
}

function stateFile(prefix: string, key: string): string {
  return join(stateDir(), `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
}

/**
 * Rate limiter backed by CLAUDE_PLUGIN_DATA (falls back to tmpdir).
 * Returns true when the action is allowed and records the attempt.
 * intervalMin <= 0 disables throttling.
 */
export function throttle(key: string, intervalMin: number): boolean {
  if (intervalMin <= 0) return true;
  try {
    mkdirSync(stateDir(), { recursive: true });
    const file = stateFile('throttle', key);
    const now = Date.now();
    if (existsSync(file)) {
      const last = Number(readFileSync(file, 'utf-8'));
      if (Number.isFinite(last) && now - last < intervalMin * 60_000) return false;
    }
    writeFileSync(file, String(now));
    return true;
  } catch {
    return true; // never let bookkeeping failures suppress the hook
  }
}

/** Record that the session performed persistable work. */
export function touchMarker(key: string): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(stateFile('marker', key), String(Date.now()));
  } catch {
    // best-effort bookkeeping
  }
}

/** Timestamp of a marker, or 0 when absent/unreadable. */
export function readMarker(key: string): number {
  try {
    const n = Number(readFileSync(stateFile('marker', key), 'utf-8'));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Remove a marker once its work has been handled. */
export function clearMarker(key: string): void {
  try {
    rmSync(stateFile('marker', key), { force: true });
  } catch {
    // best-effort bookkeeping
  }
}

export function intervalEnv(name: string, defaultMin: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultMin;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultMin;
}
