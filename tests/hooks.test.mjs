import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function runHook(name, input, env = {}) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'dist', 'src', 'hooks', `${name}.js`)],
    {
      input: JSON.stringify(input),
      encoding: 'utf-8',
      env: { ...process.env, REQALL_PROJECT_NAME: 'TestProj', ...env },
    },
  );
  assert.equal(result.status, 0, `hook ${name} exited ${result.status}: ${result.stderr}`);
  const out = result.stdout.trim();
  return out ? JSON.parse(out) : null;
}

function dataDir() {
  return mkdtempSync(join(tmpdir(), 'reqall-hook-test-'));
}

test('session-start emits additionalContext with project name and context skill', () => {
  const out = runHook('session-start', {
    hook_event_name: 'SessionStart',
    session_id: 'abc',
    cwd: root,
  });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[reqall\]/);
  assert.match(ctx, /TestProj/);
  assert.match(ctx, /reqall:context/);
});

test('pre-tool emits per-file search context from tool_input.file_path', () => {
  const out = runHook('pre-tool', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: 'C:/x/y.ts' },
  });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /C:\/x\/y\.ts/);
  assert.match(ctx, /search/);
  assert.match(ctx, /TestProj/);
});

test('pre-tool uses notebook_path when file_path absent', () => {
  const out = runHook('pre-tool', {
    tool_name: 'NotebookEdit',
    tool_input: { notebook_path: '/n/b.ipynb' },
  });
  assert.match(out.hookSpecificOutput.additionalContext, /\/n\/b\.ipynb/);
});

test('pre-tool is silent when no path in tool_input', () => {
  const out = runHook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(out, null);
});

test('post-tool emits documentation context, then throttles within interval', () => {
  const data = dataDir();
  const input = {
    hook_event_name: 'PostToolUse',
    session_id: 's1',
    tool_name: 'Write',
    tool_input: { file_path: '/a.ts' },
  };
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_DOC_INTERVAL_MIN: '10' };
  const first = runHook('post-tool', input, env);
  assert.equal(first.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(first.hookSpecificOutput.additionalContext, /reqall:document|document/i);
  const second = runHook('post-tool', input, env);
  assert.equal(second, null, 'second emission within interval should be throttled');
});

test('post-tool interval of 0 disables throttling', () => {
  const data = dataDir();
  const input = { tool_name: 'Edit', tool_input: { file_path: '/b.ts' }, session_id: 's1' };
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_DOC_INTERVAL_MIN: '0' };
  assert.notEqual(runHook('post-tool', input, env), null);
  assert.notEqual(runHook('post-tool', input, env), null);
});

test('stop blocks active sessions and clears the activity marker', () => {
  const data = dataDir();
  const env = {
    CLAUDE_PLUGIN_DATA: data,
    REQALL_DOC_INTERVAL_MIN: '0',
    REQALL_PERSIST_INTERVAL_MIN: '0',
    REQALL_IDLE_PERSIST_INTERVAL_MIN: '0',
  };
  runHook('post-tool', { session_id: 's2', tool_name: 'Write', tool_input: { file_path: '/a.ts' } }, env);
  const out = runHook('stop', { session_id: 's2', stop_hook_active: false }, env);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /reqall:persist/);
  assert.match(out.reason, /TestProj/);
  const again = runHook('stop', { session_id: 's2', stop_hook_active: false }, env);
  assert.equal(again, null, 'marker cleared after block; idle blocks disabled');
});

test('stop blocks idle sessions at the idle interval', () => {
  const data = dataDir();
  const out = runHook(
    'stop',
    { hook_event_name: 'Stop', session_id: 's3', stop_hook_active: false },
    { CLAUDE_PLUGIN_DATA: data },
  );
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /reqall:persist/);
});

test('stop is silent for idle sessions when idle interval is 0', () => {
  const data = dataDir();
  const out = runHook(
    'stop',
    { session_id: 's4', stop_hook_active: false },
    { CLAUDE_PLUGIN_DATA: data, REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' },
  );
  assert.equal(out, null);
});

test('stop is silent when stop_hook_active is true', () => {
  const data = dataDir();
  const out = runHook(
    'stop',
    { session_id: 's5', stop_hook_active: true },
    { CLAUDE_PLUGIN_DATA: data },
  );
  assert.equal(out, null);
});

test('stop throttles repeat blocks within persist interval for same session', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '30' };
  const input = { session_id: 's6', stop_hook_active: false };
  assert.equal(runHook('stop', input, env).decision, 'block');
  assert.equal(runHook('stop', input, env), null, 'second block within interval should be suppressed');
});

test('subagent-stop is silent but records activity for the stop hook', () => {
  const data = dataDir();
  const env = {
    CLAUDE_PLUGIN_DATA: data,
    REQALL_PERSIST_INTERVAL_MIN: '0',
    REQALL_IDLE_PERSIST_INTERVAL_MIN: '0',
  };
  const out = runHook('subagent-stop', { agent_type: 'Plan', session_id: 's7' }, env);
  assert.equal(out, null, 'SubagentStop output is ignored by Claude Code, so emit nothing');
  const stop = runHook('stop', { session_id: 's7', stop_hook_active: false }, env);
  assert.equal(stop.decision, 'block', 'subagent activity should enable the active persist path');
});

test('user-prompt-submit nudges intend for task-shaped prompts, then throttles', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_INTENT_INTERVAL_MIN: '15' };
  const input = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'u1',
    prompt: 'Please add rate limiting to the upload endpoint and cover it with tests',
  };
  const first = runHook('user-prompt-submit', input, env);
  assert.equal(first.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(first.hookSpecificOutput.additionalContext, /reqall:intend/);
  assert.match(first.hookSpecificOutput.additionalContext, /TestProj/);
  assert.equal(runHook('user-prompt-submit', input, env), null, 'throttled within interval');
});

test('user-prompt-submit skips short prompts and slash commands', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_INTENT_INTERVAL_MIN: '0' };
  assert.equal(runHook('user-prompt-submit', { session_id: 'u2', prompt: 'yes, go ahead' }, env), null);
  assert.equal(
    runHook('user-prompt-submit', { session_id: 'u2', prompt: '/reqall:review issues please and thank you' }, env),
    null,
  );
  assert.equal(runHook('user-prompt-submit', { session_id: 'u2' }, env), null);
});

test('plan-accepted instructs intend after ExitPlanMode and marks activity', () => {
  const data = dataDir();
  const env = {
    CLAUDE_PLUGIN_DATA: data,
    REQALL_PERSIST_INTERVAL_MIN: '0',
    REQALL_IDLE_PERSIST_INTERVAL_MIN: '0',
  };
  const out = runHook(
    'plan-accepted',
    { hook_event_name: 'PostToolUse', session_id: 'p1', tool_name: 'ExitPlanMode', tool_input: {} },
    env,
  );
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /reqall:intend/);
  assert.match(out.hookSpecificOutput.additionalContext, /plan/i);
  const stop = runHook('stop', { session_id: 'p1', stop_hook_active: false }, env);
  assert.equal(stop.decision, 'block', 'plan acceptance counts as session activity');
});

test('plan-accepted is silent for other tools', () => {
  assert.equal(runHook('plan-accepted', { tool_name: 'Write', tool_input: { file_path: '/a' } }), null);
});

const specResponse = JSON.stringify({
  ok: true,
  data: {
    action: 'created',
    record: { id: 4695, project_id: 1, kind: 'spec', title: 'SPEC: Intent flow', status: 'open' },
  },
});

test('intent-track records spec upserts (content-block response) and stop lists them for reconciliation', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  const out = runHook(
    'intent-track',
    {
      hook_event_name: 'PostToolUse',
      session_id: 'i1',
      tool_name: 'mcp__plugin_reqall_reqall__upsert_record',
      tool_input: { project_id: 1, kind: 'spec', title: 'SPEC: Intent flow', body: '...' },
      tool_response: [{ type: 'text', text: specResponse }],
    },
    env,
  );
  assert.equal(out, null, 'intent-track is side-effect only');
  const stop = runHook('stop', { session_id: 'i1', stop_hook_active: false }, env);
  assert.equal(stop.decision, 'block', 'intent alone is persistable work');
  assert.match(stop.reason, /Intent records written this session: #4695 spec "SPEC: Intent flow"/);
  // Links ride inline on upsert_record; the prompt must never ask for the second call.
  assert.match(stop.reason, /links: \[\{target_id: <intent id>, relationship: "implements"\}\]/);
  assert.match(stop.reason, /links: \[\{target_id: <intent id>, relationship: "blocks"\}\]/);
  assert.doesNotMatch(stop.reason, /upsert_link (work|todo)/);
  // Cleared once persist was forced: PreCompact no longer lists it.
  const pc = runHook('pre-compact', { session_id: 'i1' }, env);
  assert.doesNotMatch(pc.hookSpecificOutput.additionalContext, /#4695/);
});

test('intent-track accepts an object response, the claude.ai namespace, and de-duplicates by id', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data };
  const base = { session_id: 'i2', tool_name: 'mcp__Reqall__upsert_record' };
  runHook('intent-track', { ...base, tool_input: { kind: 'arch', title: 'ARCH: X' }, tool_response: JSON.parse(specResponse) }, env);
  runHook(
    'intent-track',
    {
      ...base,
      tool_input: { id: 4695, body: 'updated' },
      tool_response: { structuredContent: { ok: true, data: { action: 'updated', record: { id: 4695, kind: 'spec', title: 'SPEC: Intent flow v2' } } } },
    },
    env,
  );
  const pc = runHook('pre-compact', { session_id: 'i2' }, env);
  const ctx = pc.hookSpecificOutput.additionalContext;
  assert.match(ctx, /#4695 spec "SPEC: Intent flow v2"/);
  assert.equal(ctx.match(/#4695/g).length, 1, 'same record listed once');
});

test('intent-track ignores non-intent kinds and other tools', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data };
  const todo = JSON.stringify({ ok: true, data: { action: 'created', record: { id: 7, kind: 'todo', title: 'TASK: x' } } });
  runHook(
    'intent-track',
    { session_id: 'i3', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'todo' }, tool_response: [{ type: 'text', text: todo }] },
    env,
  );
  runHook(
    'intent-track',
    { session_id: 'i3', tool_name: 'mcp__plugin_reqall_reqall__upsert_link', tool_input: {}, tool_response: specResponse },
    env,
  );
  const pc = runHook('pre-compact', { session_id: 'i3' }, env);
  assert.doesNotMatch(pc.hookSpecificOutput.additionalContext, /Intent records/);
});

test('intent-track falls back to tool_input when the response carries no record', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data };
  runHook(
    'intent-track',
    { session_id: 'i4', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { id: 42, kind: 'spec', title: 'SPEC: from input' }, tool_response: 'ok' },
    env,
  );
  const pc = runHook('pre-compact', { session_id: 'i4' }, env);
  assert.match(pc.hookSpecificOutput.additionalContext, /#42 spec "SPEC: from input"/);
});

test('intent-track records get_record reads as consulted; consulted alone does not force a persist', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook(
    'intent-track',
    {
      session_id: 'c1',
      tool_name: 'mcp__plugin_reqall_reqall__get_record',
      tool_input: { id: 4695 },
      tool_response: [{ type: 'text', text: JSON.stringify({ ok: true, data: { record: { id: 4695, kind: 'spec', title: 'SPEC: Intent flow' } } }) }],
    },
    env,
  );
  const stop = runHook('stop', { session_id: 'c1', stop_hook_active: false }, env);
  assert.equal(stop, null, 'reading a spec is not session activity');
  const pc = runHook('pre-compact', { session_id: 'c1' }, env);
  const ctx = pc.hookSpecificOutput.additionalContext;
  assert.match(ctx, /consulted this session: #4695 spec "SPEC: Intent flow"/);
  assert.doesNotMatch(ctx, /written this session/);
});

test('intent-track ignores get_record of non-intent kinds and never trusts tool_input.kind for reads', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data };
  runHook(
    'intent-track',
    {
      session_id: 'c2',
      tool_name: 'mcp__Reqall__get_record',
      tool_input: { id: 7, kind: 'spec' },
      tool_response: { ok: true, data: { record: { id: 7, kind: 'todo', title: 'TASK: x' } } },
    },
    env,
  );
  runHook('intent-track', { session_id: 'c2', tool_name: 'mcp__Reqall__get_record', tool_input: { id: 8 }, tool_response: 'ok' }, env);
  const pc = runHook('pre-compact', { session_id: 'c2' }, env);
  assert.doesNotMatch(pc.hookSpecificOutput.additionalContext, /Intent records|consulted/);
});

test('a write is sticky over a read for the same id, in either order', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  const rec = { id: 4695, kind: 'spec', title: 'SPEC: Intent flow' };
  const read = { session_id: 'w1', tool_name: 'mcp__plugin_reqall_reqall__get_record', tool_input: { id: 4695 }, tool_response: { data: { record: rec } } };
  const write = { session_id: 'w1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { id: 4695, body: 'x' }, tool_response: { data: { action: 'updated', record: rec } } };
  runHook('intent-track', write, env);
  runHook('intent-track', read, env);
  const pc = runHook('pre-compact', { session_id: 'w1' }, env);
  const ctx = pc.hookSpecificOutput.additionalContext;
  assert.match(ctx, /written this session: #4695/);
  assert.doesNotMatch(ctx, /consulted this session/);
  assert.equal(ctx.match(/#4695/g).length, 1);
});

test('pre-compact marks intents handed off; stop then asks to verify rather than reconcile again', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook(
    'intent-track',
    { session_id: 'h1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'spec', title: 'SPEC: Intent flow' }, tool_response: [{ type: 'text', text: specResponse }] },
    env,
  );
  const pc = runHook('pre-compact', { session_id: 'h1' }, env);
  assert.match(pc.hookSpecificOutput.additionalContext, /written this session: #4695/);
  const stop = runHook('stop', { session_id: 'h1', stop_hook_active: false }, env);
  assert.equal(stop.decision, 'block', 'handed-off intent is still persistable work');
  assert.match(stop.reason, /already handed to persist before compaction: #4695/);
  assert.match(stop.reason, /do NOT create a second work record/);
  assert.match(stop.reason, /add it inline via links on the existing record's upsert_record/);
  assert.doesNotMatch(stop.reason, /Intent records written this session/);
});

test('a fresh write after hand-off clears the handed-off mark', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  const write = { session_id: 'h2', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'spec', title: 'SPEC: Intent flow' }, tool_response: [{ type: 'text', text: specResponse }] };
  runHook('intent-track', write, env);
  runHook('pre-compact', { session_id: 'h2' }, env);
  runHook('intent-track', write, env);
  const stop = runHook('stop', { session_id: 'h2', stop_hook_active: false }, env);
  assert.match(stop.reason, /Intent records written this session: #4695/);
  assert.doesNotMatch(stop.reason, /already handed/);
});

test('pre-compact instructs persist before compaction', () => {
  const out = runHook('pre-compact', { hook_event_name: 'PreCompact', session_id: 's8' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreCompact');
  assert.match(out.hookSpecificOutput.additionalContext, /persist/i);
});

test('project name falls back to git remote when env unset', () => {
  const result = spawnSync(
    process.execPath,
    [join(root, 'dist', 'src', 'hooks', 'session-start.js')],
    {
      input: JSON.stringify({ cwd: root }),
      encoding: 'utf-8',
      cwd: root,
      env: { ...process.env, REQALL_PROJECT_NAME: '' },
    },
  );
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.match(out.hookSpecificOutput.additionalContext, /ReqallSystem\/claude-plugin/);
});

test('index --json resolves the manifest from .claude-plugin', () => {
  const result = spawnSync(
    process.execPath,
    [join(root, 'dist', 'src', 'index.js'), '--json'],
    { encoding: 'utf-8' },
  );
  assert.equal(result.status, 0, `index --json exited ${result.status}: ${result.stderr}`);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.name, 'reqall');
  assert.equal(manifest.dir, root);
});

function runAuthHeaders(env) {
  const result = spawnSync(process.execPath, [join(root, 'dist', 'src', 'auth-headers.js')], {
    encoding: 'utf-8',
    env: { ...process.env, REQALL_API_KEY: undefined, ...env },
  });
  assert.equal(result.status, 0, `auth-headers exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('auth-headers emits no Authorization when REQALL_API_KEY is unset, so OAuth can run', () => {
  assert.deepEqual(runAuthHeaders({}), {});
});

test('auth-headers treats a blank REQALL_API_KEY as unset', () => {
  assert.deepEqual(runAuthHeaders({ REQALL_API_KEY: '   ' }), {});
});

test('auth-headers emits a bearer token when REQALL_API_KEY is set', () => {
  assert.deepEqual(runAuthHeaders({ REQALL_API_KEY: 'rq_test' }), { Authorization: 'Bearer rq_test' });
});

test('project name falls back to the machine project when not a git repo', () => {
  const dir = dataDir();
  const result = spawnSync(
    process.execPath,
    [join(root, 'dist', 'src', 'hooks', 'session-start.js')],
    {
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf-8',
      cwd: dir,
      env: { ...process.env, REQALL_PROJECT_NAME: '', REQALL_MACHINE_NAME: '' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.match(out.hookSpecificOutput.additionalContext, /project_name=\.machine\/[^/]+\/[^/\s:]+/);
  assert.match(out.hookSpecificOutput.additionalContext, /Reserved routing/);
});

test('REQALL_MACHINE_NAME overrides the hostname segment', () => {
  const dir = dataDir();
  const result = spawnSync(
    process.execPath,
    [join(root, 'dist', 'src', 'hooks', 'session-start.js')],
    {
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf-8',
      cwd: dir,
      env: { ...process.env, REQALL_PROJECT_NAME: '', REQALL_MACHINE_NAME: 'CI-Box' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.match(out.hookSpecificOutput.additionalContext, /project_name=\.machine\/ci-box\//);
});
