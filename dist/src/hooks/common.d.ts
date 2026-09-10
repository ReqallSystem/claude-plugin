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
export declare function sessionKey(input: HookInput): string;
/**
 * The reserved machine project for this box and OS user:
 * `.machine/<hostname>/<os-user>`. REQALL_MACHINE_NAME overrides the hostname
 * segment — set it in CI/containers where hostnames are ephemeral, so runs
 * don't mint a fresh project each time. The server auto-creates `.user` and
 * links it parent→ this project on first upsert.
 */
export declare function machineProjectName(): string;
export declare function extractProjectHint(text: string | undefined): string | undefined;
/** Project names are unique case-insensitively server-side; compare the same way. */
export declare function sameProject(a: string | undefined, b: string | undefined): boolean;
/**
 * Whether the session's subscription (if any) was bound under a different
 * project than the one now resolved — a later `project_name=` selection in a
 * non-repo session, for instance. Unknown binding names count as current.
 */
export declare function subscriptionStale(st: SessionState, name: string): boolean;
/**
 * REQALL_PROJECT_NAME > git remote org/repo > labelled `project_name=` from
 * a prompt this session (see UserPromptSubmit) > machine project. Never the
 * cwd basename.
 */
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
 * Per-session bookkeeping that several hooks share. Everything here is
 * best-effort: a missing or corrupt file reads as the empty state.
 */
export interface SessionState {
    /** Reqall project id observed from upsert_project (model or hook). */
    project_id?: number;
    project_name?: string;
    /** Labelled `project_name=` selection seen in a prompt this session. */
    prompt_project?: string;
    /** Project whose subscription (subscriber = session id) exists server-side. */
    subscribed_project_id?: number;
    /** Name that subscription was bound under, when known, so a later project change can rebind. */
    subscribed_project_name?: string;
    /** True when the hook itself created the subscription (API-key mode) and must release it. */
    subscribed_by_hook?: boolean;
    /** Server predates the subscription tools; stop trying for this session. */
    subscriptions_unavailable?: boolean;
    /** Record ids this session wrote via upsert_record, for own-write filtering. */
    written_ids?: number[];
    /** Intent ids covered by an outcome record's implements/blocks link this session. */
    reconciled?: number[];
    /** When the Stop hook last blocked for persist; unset once verified. */
    block_at?: number;
    /** The verification pass already re-blocked once for this cycle. */
    reblocked?: boolean;
    /** Last successful outcome upsert_record observed. */
    persisted_at?: number;
}
export declare function readState(key: string): SessionState;
export declare function updateState(key: string, mutate: (st: SessionState) => void): SessionState;
/** Remove every state, marker, throttle, and intent file belonging to a session. */
export declare function cleanupSession(key: string): void;
export declare function isMutatingBash(command: unknown): boolean;
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
/** Replace the session's intent file with the given entries (empty removes it). */
export declare function writeIntents(key: string, intents: IntentEntry[]): void;
/** Rewrite the session's intent file with every entry marked as handed off to persist. */
export declare function markIntentsHandedOff(key: string): void;
/** Remove the session's intent file once the work has been reconciled. */
export declare function clearIntents(key: string): void;
export declare function fmtIntent(i: IntentEntry): string;
/**
 * Human-readable reconciliation instructions for the persist step, or '' when
 * the session touched no intent. Shared by the Stop and PreCompact hooks.
 */
export declare function intentContext(intents: IntentEntry[]): string;
/**
 * Hooks hold no OAuth token — Claude Code keeps that for the MCP connection —
 * so direct server calls are possible only when REQALL_API_KEY is set. The
 * server URL follows the plugin's user_config when Claude Code exports it,
 * else REQALL_URL, else the public server.
 */
export declare function apiKey(): string;
export declare function apiUrl(): string;
export interface McpResult {
    ok: boolean;
    data?: unknown;
    error?: string;
    /** True when the server rejected the tool name itself (older server). */
    unsupported?: boolean;
}
/** Pick the JSON-RPC message for `id` out of a streamable-HTTP SSE body. */
export declare function parseSseJsonRpc(raw: string, id: string): unknown;
/**
 * Unwrap a tools/call reply to the Reqall envelope `{ok, data}`. The server
 * returns the same JSON both as structuredContent and as a text block.
 */
export declare function normalizeMcpResult(rpc: unknown): McpResult;
/** One tools/call over streamable HTTP. Fails closed on any transport problem. */
export declare function mcpCall(tool: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpResult>;
export interface SubscriptionEvent {
    action?: string;
    record_id?: number;
    kind?: string;
    title?: string;
    actor?: string;
}
/**
 * Own-write ids whose actor=self events a poll has now delivered. Since
 * actor=self is account-level, an id stays filtered only until its own
 * events have been consumed; a later self event for it is another session of
 * this account and must show. Ids retire on first sight, even from a
 * truncated page (has_more): a trailing event of the same write on the next
 * page then shows once as another session, which is bounded, whereas holding
 * the id until the page that never repeats it would filter it forever.
 */
export declare function consumedOwnIds(data: unknown, ownIds: number[]): number[];
/** Drop delivered own-write ids from the session state (see consumedOwnIds). */
export declare function retireOwnIds(key: string, ids: number[]): void;
/**
 * Render a poll_subscriptions result for injection, or '' when quiet. Events
 * for records this session wrote are dropped; other sessions of the same
 * account still show (actor=self is account-level).
 */
export declare function formatUpdates(data: unknown, ownIds: number[], maxLen?: number): string;
/** Project id out of an upsert_project reply (`{action, project: {id}}`). */
export declare function parseProjectId(data: unknown): number | undefined;
//# sourceMappingURL=common.d.ts.map