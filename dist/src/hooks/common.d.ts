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
export declare function readStdin(): HookInput;
/** REQALL_PROJECT_NAME > git remote org/repo > cwd basename. */
export declare function projectName(input: HookInput): string;
/** Emit additionalContext for the given event and exit 0. */
export declare function emitContext(eventName: string, context: string): void;
/**
 * Rate limiter backed by CLAUDE_PLUGIN_DATA (falls back to tmpdir).
 * Returns true when the action is allowed and records the attempt.
 * intervalMin <= 0 disables throttling.
 */
export declare function throttle(key: string, intervalMin: number): boolean;
export declare function intervalEnv(name: string, defaultMin: number): number;
//# sourceMappingURL=common.d.ts.map