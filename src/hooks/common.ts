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
  tool_response?: unknown;
  prompt?: string;
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

/** A spec/arch record written during this session — the agreed intent the work should satisfy. */
export interface IntentEntry {
  id: number;
  kind: string;
  title: string;
  action?: string;
}

const INTENT_KINDS = new Set(['spec', 'arch']);

/** Kinds whose upserts count as intent (what the work is supposed to satisfy). */
export function isIntentKind(kind: unknown): kind is string {
  return typeof kind === 'string' && INTENT_KINDS.has(kind);
}

/** Append an intent record to the session's JSONL intent file. */
export function appendIntent(key: string, entry: IntentEntry): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(stateFile('intent', key), JSON.stringify(entry) + '\n');
  } catch {
    // best-effort bookkeeping
  }
}

/** Intent records for the session, de-duplicated by id (latest entry wins). */
export function readIntents(key: string): IntentEntry[] {
  try {
    const byId = new Map<number, IntentEntry>();
    for (const line of readFileSync(stateFile('intent', key), 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as IntentEntry;
        if (typeof e.id === 'number') byId.set(e.id, e);
      } catch {
        // skip malformed line
      }
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}

/** Remove the session's intent file once the work has been reconciled. */
export function clearIntents(key: string): void {
  try {
    rmSync(stateFile('intent', key), { force: true });
  } catch {
    // best-effort bookkeeping
  }
}

/**
 * Human-readable reconciliation instructions for the persist step, or '' when
 * the session recorded no intent. Shared by the Stop and PreCompact hooks.
 */
export function intentContext(intents: IntentEntry[]): string {
  if (intents.length === 0) return '';
  const list = intents
    .map((i) => `#${i.id} ${i.kind} "${i.title.replace(/"/g, "'")}"`)
    .join('; ');
  return (
    ` Intent records written this session: ${list}. Reconcile the work against them: ` +
    `create one \`work\` record summarizing what was done; for each intent the work fulfills, ` +
    `upsert_link work --implements--> intent and set the work record resolved; for each intent ` +
    `not (fully) fulfilled, create a todo/open describing the gap and upsert_link todo --blocks--> intent.`
  );
}
