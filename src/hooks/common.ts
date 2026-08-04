/**
 * Shared helpers for Reqall hook scripts.
 *
 * Hooks receive a JSON payload on stdin and communicate back to Claude Code
 * by printing a JSON object to stdout (exit code 0). Printing nothing means
 * "no action". See https://code.claude.com/docs/en/hooks
 */
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** REQALL_PROJECT_NAME > git remote org/repo > cwd basename. */
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
  return basename(cwd);
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

/**
 * Rate limiter backed by CLAUDE_PLUGIN_DATA (falls back to tmpdir).
 * Returns true when the action is allowed and records the attempt.
 * intervalMin <= 0 disables throttling.
 */
export function throttle(key: string, intervalMin: number): boolean {
  if (intervalMin <= 0) return true;
  const dir =
    process.env.CLAUDE_PLUGIN_DATA ||
    join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'reqall-plugin');
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `throttle-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
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

export function intervalEnv(name: string, defaultMin: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultMin;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultMin;
}
