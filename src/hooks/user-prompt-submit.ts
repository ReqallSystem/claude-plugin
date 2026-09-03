#!/usr/bin/env node
/**
 * UserPromptSubmit: per-task nudge to record agreed intent (spec/arch) before
 * work begins. Advisory and throttled via REQALL_INTENT_INTERVAL_MIN
 * (default 15, 0 disables throttling); very short prompts and slash commands
 * are skipped so acknowledgements and menu commands never trigger it. The
 * deterministic trigger is the ExitPlanMode hook (plan-accepted.ts).
 */
import { emitContext, intervalEnv, projectName, readStdin, throttle } from './common.js';

const MIN_PROMPT_CHARS = 30;

const input = readStdin();
const prompt = (input.prompt ?? '').trim();

if (prompt.length >= MIN_PROMPT_CHARS && !prompt.startsWith('/')) {
  const sessionId = input.session_id ?? 'global';
  const interval = intervalEnv('REQALL_INTENT_INTERVAL_MIN', 15);
  if (throttle(`intent-${sessionId}`, interval)) {
    const name = projectName(input);
    emitContext(
      'UserPromptSubmit',
      `[reqall] If this prompt starts or continues a coding task whose scope is agreed ` +
        `(the user confirmed an approach, or asked for a specific change), invoke the ` +
        `reqall:intend skill with project_name="${name}" BEFORE editing: find or upsert the ` +
        `spec/arch record for what is to be, link it to related records, then do the work. ` +
        `Skip for questions, chat, chores, and single-file fixes.`,
    );
  }
}
