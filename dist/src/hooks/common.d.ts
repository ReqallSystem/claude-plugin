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
export declare function readStdin(): HookInput;
/**
 * The reserved machine project for this box and OS user:
 * `.machine/<hostname>/<os-user>`. REQALL_MACHINE_NAME overrides the hostname
 * segment — set it in CI/containers where hostnames are ephemeral, so runs
 * don't mint a fresh project each time. The server auto-creates `.user` and
 * links it parent→ this project on first upsert.
 */
export declare function machineProjectName(): string;
/** REQALL_PROJECT_NAME > git remote org/repo > machine project (never the cwd basename). */
export declare function projectName(input: HookInput): string;
/** Emit additionalContext for the given event and exit 0. */
export declare function emitContext(eventName: string, context: string): void;
/**
 * Rate limiter backed by CLAUDE_PLUGIN_DATA (falls back to tmpdir).
 * Returns true when the action is allowed and records the attempt.
 * intervalMin <= 0 disables throttling.
 */
export declare function throttle(key: string, intervalMin: number): boolean;
/** Record that the session performed persistable work. */
export declare function touchMarker(key: string): void;
/** Timestamp of a marker, or 0 when absent/unreadable. */
export declare function readMarker(key: string): number;
/** Remove a marker once its work has been handled. */
export declare function clearMarker(key: string): void;
export declare function intervalEnv(name: string, defaultMin: number): number;
/**
 * A spec/arch record touched during this session. `written` entries come from
 * upsert_record (the agreed intent the work should satisfy); `consulted` ones
 * from get_record (an existing spec the intend skill selected without editing,
 * or simply read for context). `handed_off` marks entries already given to
 * persist by the PreCompact hook, so Stop asks for verification rather than a
 * second reconciliation.
 */
export interface IntentEntry {
    id: number;
    kind: string;
    title: string;
    action?: string;
    via?: 'written' | 'consulted';
    handed_off?: boolean;
}
/** Kinds whose upserts count as intent (what the work is supposed to satisfy). */
export declare function isIntentKind(kind: unknown): kind is string;
export declare function isWritten(e: IntentEntry): boolean;
/** Append an intent record to the session's JSONL intent file. */
export declare function appendIntent(key: string, entry: IntentEntry): void;
/**
 * Intent records for the session, merged by id in file order: a write is
 * sticky over a read, a later write clears a hand-off mark, and the newest
 * title wins. Consulted-only entries are capped to the most recent few.
 */
export declare function readIntents(key: string): IntentEntry[];
/** Rewrite the session's intent file with every entry marked as handed off to persist. */
export declare function markIntentsHandedOff(key: string): void;
/** Remove the session's intent file once the work has been reconciled. */
export declare function clearIntents(key: string): void;
/**
 * Human-readable reconciliation instructions for the persist step, or '' when
 * the session touched no intent. Shared by the Stop and PreCompact hooks.
 */
export declare function intentContext(intents: IntentEntry[]): string;
//# sourceMappingURL=common.d.ts.map