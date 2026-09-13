import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
      env: { ...process.env, REQALL_PROJECT_NAME: 'TestProj', REQALL_API_KEY: '', ...env },
    },
  );
  assert.equal(result.status, 0, `hook ${name} exited ${result.status}: ${result.stderr}`);
  const out = result.stdout.trim();
  return out ? JSON.parse(out) : null;
}


/** Async variant for tests that run an in-process mock server: spawnSync would block it. */
function runHookAsync(name, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'dist', 'src', 'hooks', `${name}.js`)], {
      env: { ...process.env, REQALL_PROJECT_NAME: 'TestProj', REQALL_API_KEY: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`hook ${name} exited ${code}: ${stderr}`));
      const out = stdout.trim();
      resolve(out ? JSON.parse(out) : null);
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function dataDir() {
  return mkdtempSync(join(tmpdir(), 'reqall-hook-test-'));
}

test('portable naming: shipped session-start discovers ancestor YAML before package metadata', () => {
  const dir = dataDir();
  const cwd = join(dir, 'src');
  mkdirSync(cwd);
  writeFileSync(join(dir, '.reqall.yaml'), 'project: acme/portable\n');
  writeFileSync(join(cwd, 'package.json'), '{"name":"@acme/package"}');
  const env = { CLAUDE_PLUGIN_DATA: dataDir(), REQALL_PROJECT_NAME: '', REQALL_API_KEY: '', REQALL_WORKSPACE_ROOT: dir };
  const out = runHook('session-start', { session_id: 'portable', cwd }, env);
  assert.match(out.hookSpecificOutput.additionalContext, /project_name=acme\/portable:/);
});

test('portable naming: selection survives subsequent hooks and synthetic reports', () => {
  const cwd = dataDir();
  writeFileSync(join(cwd, 'package.json'), '{"name":"@acme/local"}');
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_API_KEY: '', REQALL_WORKSPACE_ROOT: cwd, REQALL_INTENT_INTERVAL_MIN: '0' };
  const input = { session_id: 'retained', cwd };
  runHook('user-prompt-submit', { ...input, prompt: 'project: "acme/chosen" implement the requested feature' }, env);
  runHook('user-prompt-submit', { ...input, prompt: 'continue' }, env);
  for (const hook of ['session-start', 'pre-compact', 'plan-accepted']) {
    const out = runHook(hook, { ...input, tool_name: 'ExitPlanMode' }, env);
    assert.match(out.hookSpecificOutput.additionalContext, /acme\/chosen/, hook);
  }
  runHook('user-prompt-submit', { ...input, prompt: '[ASYNC SUBAGENT REPORT] example project_name=wrong/example; tests complete' }, env);
  assert.equal(JSON.parse(readFileSync(join(data, 'state-retained'), 'utf8')).prompt_project, 'acme/chosen');
});

test('portable naming: package, workspace boundary, and local origin fallthrough reach shipped hooks', () => {
  const dir = dataDir();
  const workspace = join(dir, 'workspace');
  const cwd = join(workspace, 'src', 'work');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(dir, '.reqall.yml'), 'project: outside/boundary\n');
  const env = { CLAUDE_PLUGIN_DATA: dataDir(), REQALL_PROJECT_NAME: '  ', REQALL_API_KEY: '', REQALL_WORKSPACE_ROOT: workspace };
  const context = () => runHook('session-start', { session_id: 'boundaries', cwd }, env).hookSpecificOutput.additionalContext;
  assert.match(context(), /project_name=src\/work:/);
  writeFileSync(join(cwd, 'package.json'), '{"name":"@acme/package"}');
  assert.match(context(), /project_name=acme\/package:/);
  assert.equal(spawnSync('git', ['init', '-q', cwd]).status, 0);
  assert.equal(spawnSync('git', ['-C', cwd, 'remote', 'add', 'origin', '/local/not-portable.git']).status, 0);
  assert.match(context(), /project_name=acme\/package:/);
  assert.equal(spawnSync('git', ['-C', cwd, 'remote', 'set-url', 'origin', 'https://gitlab.com/group/sub/repo.git/']).status, 0);
  assert.match(context(), /project_name=sub\/repo:/);
  env.REQALL_PROJECT_NAME = '  historical Explicit Name  ';
  assert.match(context(), /project_name=historical Explicit Name:/);
});

test('portable naming: remote-derived names must satisfy the automatic-name grammar', () => {
  const dir = dataDir();
  const cwd = join(dir, 'app');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), '{"name":"@acme/fallback"}');
  const env = { CLAUDE_PLUGIN_DATA: dataDir(), REQALL_PROJECT_NAME: '', REQALL_API_KEY: '', REQALL_WORKSPACE_ROOT: dir };
  const context = () => runHook('session-start', { session_id: 'grammar', cwd }, env).hookSpecificOutput.additionalContext;
  assert.equal(spawnSync('git', ['init', '-q', cwd]).status, 0);
  for (const origin of ['https://host/org/r%C3%A9po.git', 'git@host:org/my repo.git', 'https://host/org/rép.git', 'ssh://git@host/org/re$po.git']) {
    assert.equal(spawnSync('git', ['-C', cwd, 'remote', origin.startsWith('https://host/org/r%') ? 'add' : 'set-url', 'origin', origin]).status, 0, origin);
    assert.match(context(), /project_name=acme\/fallback:/, origin);
  }
  assert.equal(spawnSync('git', ['-C', cwd, 'remote', 'set-url', 'origin', 'git@host:org/valid_repo.v2.git']).status, 0);
  assert.match(context(), /project_name=org\/valid_repo\.v2:/);
});

test('portable naming: conflicting YAML project/name aliases are ambiguous and skipped', () => {
  const dir = dataDir();
  const cwd = join(dir, 'app');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), '{"name":"@acme/fallback"}');
  const env = { CLAUDE_PLUGIN_DATA: dataDir(), REQALL_PROJECT_NAME: '', REQALL_API_KEY: '', REQALL_WORKSPACE_ROOT: dir };
  const context = () => runHook('session-start', { session_id: 'aliases', cwd }, env).hookSpecificOutput.additionalContext;
  writeFileSync(join(cwd, '.reqall.yml'), 'project: acme/one\nname: acme/two\n');
  assert.match(context(), /project_name=acme\/fallback:/);
  writeFileSync(join(cwd, '.reqall.yml'), 'project: acme/same\nname: "acme/same"\n');
  assert.match(context(), /project_name=acme\/same:/);
  writeFileSync(join(cwd, '.reqall.yml'), 'name: acme/alias-only\n');
  assert.match(context(), /project_name=acme\/alias-only:/);
});

test('portable naming: rebinding invalidates cached project id but retains old cursor for release', () => {
  const cwd = dataDir();
  const data = dataDir();
  writeFileSync(join(data, 'state-rebind'), JSON.stringify({ project_id: 17, project_name: 'old/name', subscribed_project_id: 17, subscribed_project_name: 'old/name' }));
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_API_KEY: '', REQALL_WORKSPACE_ROOT: cwd };
  const out = runHook('user-prompt-submit', { cwd, session_id: 'rebind', prompt: 'project_name=new/name' }, env);
  const st = JSON.parse(readFileSync(join(data, 'state-rebind'), 'utf8'));
  assert.equal(st.project_id, undefined);
  assert.equal(st.project_name, 'new/name');
  assert.equal(st.subscribed_project_id, 17);
  assert.match(out.hookSpecificOutput.additionalContext, /unsubscribe_project/);
});

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

test('stop blocks active sessions and clears the activity marker only after verification', () => {
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
  const still = runHook('stop', { session_id: 's2', stop_hook_active: false }, env);
  assert.equal(still.decision, 'block', 'a block is a request, not proof persist ran: marker survives');
  const verify = runHook('stop', { session_id: 's2', stop_hook_active: true }, env);
  assert.equal(verify, null, 'no intent owed: verification pass lets the turn end');
  const again = runHook('stop', { session_id: 's2', stop_hook_active: false }, env);
  assert.equal(again, null, 'marker cleared by the verification pass; idle blocks disabled');
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
    'reqall-track',
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
  // Persist wrote a work record linking the spec inline: the verification pass clears it.
  runHook(
    'reqall-track',
    {
      session_id: 'i1',
      tool_name: 'mcp__plugin_reqall_reqall__upsert_record',
      tool_input: { kind: 'work', title: 'WORK: x', links: [{ target_id: 4695, relationship: 'implements' }] },
      tool_response: [{ type: 'text', text: JSON.stringify({ ok: true, data: { action: 'created', record: { id: 9001, kind: 'work', title: 'WORK: x' }, links: [{ target_id: 4695, target_table: 'records', relationship: 'implements', direction: 'outgoing', action: 'created' }] } }) }],
    },
    env,
  );
  assert.equal(runHook('stop', { session_id: 'i1', stop_hook_active: true }, env), null, 'covered intent: no re-block');
  const pc = runHook('pre-compact', { session_id: 'i1' }, env);
  assert.doesNotMatch(pc.hookSpecificOutput.additionalContext, /#4695/);
});

test('stop re-blocks once when persist ran without linking the intent, then keeps it on file', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook(
    'reqall-track',
    { session_id: 'v1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'spec', title: 'SPEC: Intent flow' }, tool_response: [{ type: 'text', text: specResponse }] },
    env,
  );
  assert.equal(runHook('stop', { session_id: 'v1', stop_hook_active: false }, env).decision, 'block');
  // persist wrote an outcome but forgot the link
  runHook(
    'reqall-track',
    { session_id: 'v1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'work', title: 'WORK: x' }, tool_response: { ok: true, data: { action: 'created', record: { id: 9002, kind: 'work', title: 'WORK: x' } } } },
    env,
  );
  const re = runHook('stop', { session_id: 'v1', stop_hook_active: true }, env);
  assert.equal(re.decision, 'block', 'uncovered written intent re-blocks once');
  assert.match(re.reason, /no outcome record links to #4695 spec "SPEC: Intent flow"/);
  assert.match(re.reason, /Add the link inline via upsert_record on the existing work\/todo record/);
  const through = runHook('stop', { session_id: 'v1', stop_hook_active: true }, env);
  assert.equal(through, null, 'never re-blocks twice in one cycle');
  const next = runHook('stop', { session_id: 'v1', stop_hook_active: false }, env);
  assert.equal(next.decision, 'block', 'the owed intent is still persistable work at the next Stop');
  assert.match(next.reason, /Intent records written this session: #4695/);
});

test('stop verification pass ignores blocks it did not issue and clears via blocks links too', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook(
    'reqall-track',
    { session_id: 'v2', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'spec', title: 'SPEC: Intent flow' }, tool_response: [{ type: 'text', text: specResponse }] },
    env,
  );
  assert.equal(runHook('stop', { session_id: 'v2', stop_hook_active: true }, env), null, 'no block_at: another hook blocked');
  assert.equal(runHook('stop', { session_id: 'v2', stop_hook_active: false }, env).decision, 'block');
  runHook(
    'reqall-track',
    {
      session_id: 'v2',
      tool_name: 'mcp__Reqall__upsert_record',
      tool_input: { kind: 'todo', title: 'TASK: gap' },
      tool_response: { ok: true, data: { action: 'created', record: { id: 9003, kind: 'todo', title: 'TASK: gap' }, links: [{ target_id: 4695, relationship: 'blocks', action: 'existing' }] } },
    },
    env,
  );
  assert.equal(runHook('stop', { session_id: 'v2', stop_hook_active: true }, env), null);
  assert.doesNotMatch(runHook('pre-compact', { session_id: 'v2' }, env).hookSpecificOutput.additionalContext, /#4695/);
});

test('a failed or errored link result does not count as reconciliation', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook(
    'reqall-track',
    { session_id: 'v3', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'spec' }, tool_response: [{ type: 'text', text: specResponse }] },
    env,
  );
  runHook('stop', { session_id: 'v3', stop_hook_active: false }, env);
  runHook(
    'reqall-track',
    {
      session_id: 'v3',
      tool_name: 'mcp__Reqall__upsert_record',
      tool_input: { kind: 'work' },
      tool_response: { ok: true, data: { record: { id: 9004, kind: 'work', title: 'W' }, links: [{ target_id: 4695, relationship: 'implements', action: 'error', error: 'boom' }] } },
    },
    env,
  );
  assert.equal(runHook('stop', { session_id: 'v3', stop_hook_active: true }, env).decision, 'block');
});

test('intent-track accepts an object response, the claude.ai namespace, and de-duplicates by id', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data };
  const base = { session_id: 'i2', tool_name: 'mcp__Reqall__upsert_record' };
  runHook('reqall-track', { ...base, tool_input: { kind: 'arch', title: 'ARCH: X' }, tool_response: JSON.parse(specResponse) }, env);
  runHook(
    'reqall-track',
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
    'reqall-track',
    { session_id: 'i3', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'todo' }, tool_response: [{ type: 'text', text: todo }] },
    env,
  );
  runHook(
    'reqall-track',
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
    'reqall-track',
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
    'reqall-track',
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
    'reqall-track',
    {
      session_id: 'c2',
      tool_name: 'mcp__Reqall__get_record',
      tool_input: { id: 7, kind: 'spec' },
      tool_response: { ok: true, data: { record: { id: 7, kind: 'todo', title: 'TASK: x' } } },
    },
    env,
  );
  runHook('reqall-track', { session_id: 'c2', tool_name: 'mcp__Reqall__get_record', tool_input: { id: 8 }, tool_response: 'ok' }, env);
  const pc = runHook('pre-compact', { session_id: 'c2' }, env);
  assert.doesNotMatch(pc.hookSpecificOutput.additionalContext, /Intent records|consulted/);
});

test('a write is sticky over a read for the same id, in either order', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  const rec = { id: 4695, kind: 'spec', title: 'SPEC: Intent flow' };
  const read = { session_id: 'w1', tool_name: 'mcp__plugin_reqall_reqall__get_record', tool_input: { id: 4695 }, tool_response: { data: { record: rec } } };
  const write = { session_id: 'w1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { id: 4695, body: 'x' }, tool_response: { data: { action: 'updated', record: rec } } };
  runHook('reqall-track', write, env);
  runHook('reqall-track', read, env);
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
    'reqall-track',
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
  runHook('reqall-track', write, env);
  runHook('pre-compact', { session_id: 'h2' }, env);
  runHook('reqall-track', write, env);
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

test('post-tool ignores read-only Bash commands but counts mutating ones', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_DOC_INTERVAL_MIN: '0', REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  for (const command of ['git status', 'ls -la src', 'cat package.json', 'rg -n foo src/', 'git log --oneline -5', 'find . -name "*.ts" -newer package.json']) {
    assert.equal(runHook('post-tool', { session_id: 'b1', tool_name: 'Bash', tool_input: { command } }, env), null, command);
  }
  assert.equal(runHook('stop', { session_id: 'b1', stop_hook_active: false }, env), null, 'read-only shell is not activity');
  for (const command of ['npm run build', 'git merge feat/x', 'cat a > b', 'ls && rm -rf dist', 'echo $(date) | tee log', 'find . -name "*.tmp" -delete', 'find src -type f -exec chmod +x {} +']) {
    assert.notEqual(runHook('post-tool', { session_id: 'b2', tool_name: 'Bash', tool_input: { command } }, env), null, command);
  }
  assert.equal(runHook('stop', { session_id: 'b2', stop_hook_active: false }, env).decision, 'block');
});

test('post-tool treats successful Git bookkeeping as operational, not activity (record 4982)', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_DOC_INTERVAL_MIN: '0', REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  const ok = { stdout: '', stderr: '', interrupted: false };
  const bookkeeping = [
    'git add -A',
    'git commit -m "Address review findings"',
    'git push -u origin feat/x',
    'git fetch --all --prune',
    'git pull --ff-only origin main',
    'git add -A && git commit -m "chore: bump" && git push',
    'gh pr create --fill',
    'gh pr merge 14 --merge --delete-branch',
  ];
  for (const command of bookkeeping) {
    assert.equal(runHook('post-tool', { session_id: 'g1', tool_name: 'Bash', tool_input: { command }, tool_response: ok }, env), null, command);
  }
  for (const command of ['gh pr view 14 --json state', 'gh pr checks 14', 'git ls-files src', 'git config --get remote.origin.url', 'git worktree list']) {
    assert.equal(runHook('post-tool', { session_id: 'g1', tool_name: 'Bash', tool_input: { command }, tool_response: ok }, env), null, command);
  }
  assert.equal(runHook('stop', { session_id: 'g1', stop_hook_active: false }, env), null, 'bookkeeping alone is not activity');

  // Anything the text cannot vouch for stays mutating: failures, other shell
  // syntax, Git global options and aliases, hook/transport overrides.
  const conservative = [
    ['git commit -m x', { stdout: '', stderr: 'nothing to commit', interrupted: true }],
    ['git push', { stdout: '', stderr: 'rejected', exit_code: 1 }],
    ['git add -A; git commit -m x', ok],
    ['git add -A && npm test', ok],
    ['git commit -m x || echo failed', ok],
    ['git push 2>&1', ok],
    ['git commit -m "$(date)"', ok],
    ['git -C ../other push', ok],
    ['git --no-pager commit -m x', ok],
    ['git -c core.hooksPath=/tmp/h commit -m x', ok],
    ['git push --receive-pack=/tmp/evil origin main', ok],
    ['git cm x', ok],
    ['git merge feat/x', ok],
    ['git rebase main', ok],
    ['git stash', ok],
    ['gh pr edit 14 --title x', ok],
    ['gh api -X DELETE repos/o/r', ok],
  ];
  for (const [command, tool_response] of conservative) {
    assert.notEqual(runHook('post-tool', { session_id: 'g2', tool_name: 'Bash', tool_input: { command }, tool_response }, env), null, command);
  }
  assert.equal(runHook('stop', { session_id: 'g2', stop_hook_active: false }, env).decision, 'block');
});

test('stop persist reason tells the model bookkeeping alone is nothing to persist', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook('post-tool', { session_id: 'g3', tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }, env);
  const out = runHook('stop', { session_id: 'g3', stop_hook_active: false }, env);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /bookkeeping, not work: never create a record solely for it/);
});

test('reqall-track remembers upsert_project and subscribe_project; user-prompt-submit then asks the model to poll', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_INTENT_INTERVAL_MIN: '0', REQALL_API_KEY: '' };
  const prompt = { session_id: 'sub1', prompt: 'please refactor the upload endpoint and add tests for it' };
  const before = runHook('user-prompt-submit', prompt, env);
  assert.doesNotMatch(before.hookSpecificOutput.additionalContext, /poll_subscriptions/, 'not subscribed yet');
  runHook(
    'reqall-track',
    { session_id: 'sub1', tool_name: 'mcp__plugin_reqall_reqall__upsert_project', tool_input: { name: 'TestProj' }, tool_response: [{ type: 'text', text: JSON.stringify({ ok: true, data: { action: 'created_or_found', project: { id: 1286, name: 'TestProj' } } }) }] },
    env,
  );
  runHook(
    'reqall-track',
    { session_id: 'sub1', tool_name: 'mcp__plugin_reqall_reqall__subscribe_project', tool_input: { project_id: 1286, subscriber: 'sub1' }, tool_response: { ok: true, data: { action: 'created', subscription: { id: 3, project_id: 1286, subscriber: 'sub1', cursor: 74 } } } },
    env,
  );
  runHook(
    'reqall-track',
    { session_id: 'sub1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'todo' }, tool_response: { ok: true, data: { record: { id: 555, kind: 'todo', title: 'T' } } } },
    env,
  );
  const after = runHook('user-prompt-submit', { session_id: 'sub1', prompt: 'ok' }, env);
  const ctx = after.hookSpecificOutput.additionalContext;
  assert.match(ctx, /poll_subscriptions/);
  assert.match(ctx, /subscriber="sub1"/);
  assert.match(ctx, /project_id=1286/);
  assert.match(ctx, /#555/, 'own writes are named so the model can skip actor=self events');
  assert.doesNotMatch(ctx, /reqall:intend/, 'a short acknowledgement gets the poll line only');
  assert.equal(runHook('user-prompt-submit', { session_id: 'sub1', prompt: '/reqall:review' }, env), null, 'slash commands never poll');
});

test('session-start asks the context skill to subscribe once, with the session id', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_API_KEY: '' };
  const first = runHook('session-start', { session_id: 'ss1', cwd: root }, env);
  assert.match(first.hookSpecificOutput.additionalContext, /subscribe_project .*subscriber="ss1"/);
  assert.match(first.hookSpecificOutput.additionalContext, /session_id="ss1"/);
  // A pollable subscription needs a verified project identity.
  runHook('reqall-track', { session_id: 'ss1', tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: 'TestProj' }, tool_response: { ok: true, data: { project: { id: 7, name: 'TestProj' } } } }, env);
  runHook(
    'reqall-track',
    { session_id: 'ss1', tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 7 }, tool_response: { ok: true, data: { subscription: { project_id: 7 } } } },
    env,
  );
  const compact = runHook('session-start', { session_id: 'ss1', cwd: root, source: 'compact' }, env);
  assert.doesNotMatch(compact.hookSpecificOutput.additionalContext, /subscribe_project/, 'already subscribed');
});

test('user-prompt-submit remembers a labelled project_name= selection for non-repo sessions', () => {
  const data = dataDir();
  const dir = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_INTENT_INTERVAL_MIN: '0', REQALL_API_KEY: '' };
  runHook('user-prompt-submit', { session_id: 'pp1', cwd: dir, prompt: 'work in project_name=acme/widgets please, add the parser' }, env);
  const out = runHook('session-start', { session_id: 'pp1', cwd: dir }, env);
  assert.match(out.hookSpecificOutput.additionalContext, /project_name=acme\/widgets/);
  // Prose paths are never a project.
  runHook('user-prompt-submit', { session_id: 'pp2', cwd: dir, prompt: 'edit src/auth.py and the project/README please' }, env);
  assert.match(runHook('session-start', { session_id: 'pp2', cwd: dir }, env).hookSpecificOutput.additionalContext, /project_name=\.machine\//);
  // Git origin still wins over the prompt.
  runHook('user-prompt-submit', { session_id: 'pp3', cwd: root, prompt: 'project_name=acme/widgets: refactor the hooks' }, env);
  assert.match(runHook('session-start', { session_id: 'pp3', cwd: root }, env).hookSpecificOutput.additionalContext, /ReqallSystem\/claude-plugin/);
  // Sentence punctuation after an unquoted value is prose, not part of the name.
  for (const [i, prompt] of ['project_name=acme/widgets: refactor the hooks', 'use project_name=acme/widgets. Then add tests', 'in project: acme/widgets, add tests'].entries()) {
    const sid = `pp4-${i}`;
    runHook('user-prompt-submit', { session_id: sid, cwd: dir, prompt }, env);
    assert.match(runHook('session-start', { session_id: sid, cwd: dir }, env).hookSpecificOutput.additionalContext, /project_name=acme\/widgets: \(1\)/, prompt);
  }
});

test('session-end removes every state file for the session and leaves other sessions alone', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_DOC_INTERVAL_MIN: '0', REQALL_API_KEY: '' };
  runHook('post-tool', { session_id: 'e1', tool_name: 'Write', tool_input: { file_path: '/a' } }, env);
  runHook('post-tool', { session_id: 'e2', tool_name: 'Write', tool_input: { file_path: '/a' } }, env);
  runHook('reqall-track', { session_id: 'e1', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'spec' }, tool_response: specResponse }, env);
  assert.ok(readdirSync(data).some((f) => f.endsWith('-e1')));
  assert.equal(runHook('session-end', { session_id: 'e1', reason: 'exit' }, env), null);
  assert.ok(!readdirSync(data).some((f) => f.endsWith('-e1')), 'e1 files gone');
  assert.ok(readdirSync(data).some((f) => f.endsWith('-e2')), 'e2 files kept');
});

test('portable naming: API-key rebinding releases the old cursor and caches the new id', async () => {
  const data = dataDir();
  const cwd = dataDir();
  writeFileSync(join(cwd, '.reqall.yml'), 'project: local/initial\n');
  const calls = [];
  const { server, url } = await mockServer({
    upsert_project: (a) => ({ project: { id: a.name === 'local/initial' ? 1 : 2, name: a.name } }),
    subscribe_project: (a) => ({ subscription: a }),
    unsubscribe_project: () => ({ removed: 1 }),
    poll_subscriptions: () => ({ results: [] }),
  }, calls);
  try {
    const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_WORKSPACE_ROOT: cwd, REQALL_API_KEY: 'rq_test', REQALL_URL: url };
    const input = { cwd, session_id: 'portable-api' };
    await runHookAsync('user-prompt-submit', { ...input, prompt: 'ok' }, env);
    calls.length = 0;
    await runHookAsync('user-prompt-submit', { ...input, prompt: 'project=chosen/next' }, env);
    assert.deepEqual(calls.map(c => c.name), ['upsert_project', 'unsubscribe_project', 'subscribe_project', 'poll_subscriptions']);
    assert.equal(calls[1].args.project_id, 1);
    assert.equal(calls[2].args.project_id, 2);
    const st = JSON.parse(readFileSync(join(data, 'state-portable-api'), 'utf8'));
    assert.equal(st.project_id, 2);
    assert.equal(st.subscribed_project_name, 'chosen/next');
    calls.length = 0;
    await runHookAsync('user-prompt-submit', { ...input, prompt: 'continue' }, env);
    assert.deepEqual(calls.map(c => c.name), ['poll_subscriptions']);
    assert.equal(calls[0].args.project_id, 2);
  } finally { server.close(); }
});

/** Minimal Reqall MCP server: tools/call over JSON-RPC, canned per tool. */
function mockServer(handlers, calls) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rpc = JSON.parse(body);
      const { name, arguments: args } = rpc.params;
      calls.push({ name, args, auth: req.headers.authorization });
      const data = handlers[name] ? handlers[name](args) : undefined;
      const payload =
        data === undefined
          ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown tool: ${name}` } }
          : { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }], structuredContent: { ok: true, data } } };
      if (handlers.__sse) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const poll = (events, has_more = false) => ({
  results: [{ subscription: { id: 3, project_id: 1286, project_name: 'TestProj', subscriber: 'k1', cursor: 74 }, events, has_more, next_cursor: 74 }],
  total_events: events.length,
});
const ev = (action, record_id, extra = {}) => ({ id: 1, project_id: 1286, action, record_id, kind: 'todo', title: 'T', actor: 'other', ...extra });

test('API-key mode: the hook binds, subscribes once, polls each prompt, and injects other sessions\' changes', async () => {
  const data = dataDir();
  const calls = [];
  let events = [];
  const { server, url } = await mockServer(
    {
      upsert_project: (a) => ({ action: 'created_or_found', project: { id: 1286, name: a.name } }),
      subscribe_project: (a) => ({ action: 'created', subscription: { project_id: a.project_id, subscriber: a.subscriber, cursor: 74 } }),
      poll_subscriptions: () => poll(events),
      unsubscribe_project: () => ({ removed: 1 }),
    },
    calls,
  );
  try {
    const env = { CLAUDE_PLUGIN_DATA: data, REQALL_API_KEY: 'rq_test', REQALL_URL: url, REQALL_INTENT_INTERVAL_MIN: '0' };
    const quiet = await runHookAsync('user-prompt-submit', { session_id: 'k1', prompt: 'implement the widget and its tests' }, env);
    assert.deepEqual(calls.map((c) => c.name), ['upsert_project', 'subscribe_project', 'poll_subscriptions']);
    assert.equal(calls[0].auth, 'Bearer rq_test');
    assert.deepEqual(calls[1].args, { project_id: 1286, subscriber: 'k1' });
    assert.deepEqual(calls[2].args, { subscriber: 'k1', project_id: 1286, limit: 20 });
    assert.doesNotMatch(quiet.hookSpecificOutput.additionalContext, /Reqall updates/, 'quiet poll injects nothing');
    assert.doesNotMatch(quiet.hookSpecificOutput.additionalContext, /poll_subscriptions/, 'hook polled itself; model is not asked to');

    runHook('reqall-track', { session_id: 'k1', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'todo' }, tool_response: { ok: true, data: { record: { id: 5, kind: 'todo', title: 'Mine' } } } }, env);
    calls.length = 0;
    events = [ev('record.created', 5, { actor: 'self', title: 'My own write' }), ev('record.updated', 6, { title: 'Teammate change', kind: 'spec' }), ev('record.updated', 7, { actor: 'self', title: 'Other session of mine' })];
    const second = await runHookAsync('user-prompt-submit', { session_id: 'k1', prompt: 'thanks, continue' }, env);
    assert.deepEqual(calls.map((c) => c.name), ['poll_subscriptions'], 'already bound and subscribed');
    const ctx = second.hookSpecificOutput.additionalContext;
    assert.match(ctx, /## Reqall updates since last turn/);
    assert.match(ctx, /TestProj: record.updated #6 \[spec\]: Teammate change/);
    assert.match(ctx, /#7 \[todo\] \(you, another session\): Other session of mine/);
    assert.doesNotMatch(ctx, /My own write/);

    // #5's own events were delivered, so a later self event for it is another session of this account.
    events = [ev('record.updated', 5, { actor: 'self', title: 'Edited from another session' })];
    const third = await runHookAsync('user-prompt-submit', { session_id: 'k1', prompt: 'thanks, continue' }, env);
    assert.match(third.hookSpecificOutput.additionalContext, /#5 \[todo\] \(you, another session\): Edited from another session/);
    // Writing it again re-arms the filter for that write.
    runHook('reqall-track', { session_id: 'k1', tool_name: 'mcp__Reqall__upsert_record', tool_input: { id: 5 }, tool_response: { ok: true, data: { record: { id: 5, kind: 'todo', title: 'Mine' } } } }, env);
    events = [ev('record.updated', 5, { actor: 'self', title: 'My own edit' })];
    const fourth = await runHookAsync('user-prompt-submit', { session_id: 'k1', prompt: 'thanks, continue' }, env);
    assert.equal(fourth, null, 'own edit filtered again: quiet poll, short prompt, nothing to inject');

    calls.length = 0;
    await runHookAsync('session-end', { session_id: 'k1', reason: 'exit' }, env);
    assert.deepEqual(calls.map((c) => c.name), ['unsubscribe_project'], 'hook-owned cursor released at session end');
    assert.deepEqual(calls[0].args, { project_id: 1286, subscriber: 'k1' });
  } finally {
    server.close();
  }
});

test('API-key mode: an older server without subscription tools is detected once and left alone', async () => {
  const data = dataDir();
  const calls = [];
  const { server, url } = await mockServer(
    { __sse: true, upsert_project: (a) => ({ action: 'created_or_found', project: { id: 1, name: a.name } }) },
    calls,
  );
  try {
    const env = { CLAUDE_PLUGIN_DATA: data, REQALL_API_KEY: 'rq_test', REQALL_URL: url, REQALL_INTENT_INTERVAL_MIN: '0' };
    await runHookAsync('user-prompt-submit', { session_id: 'k2', prompt: 'implement the widget and its tests' }, env);
    assert.deepEqual(calls.map((c) => c.name), ['upsert_project', 'subscribe_project']);
    calls.length = 0;
    const out = await runHookAsync('user-prompt-submit', { session_id: 'k2', prompt: 'and now implement the other widget as well please' }, env);
    assert.deepEqual(calls, [], 'no further network once unsupported');
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /poll_subscriptions|Reqall updates/);
  } finally {
    server.close();
  }
});

test('API-key mode: an unreachable server fails open with the intent nudge intact', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_API_KEY: 'rq_test', REQALL_URL: 'http://127.0.0.1:9', REQALL_INTENT_INTERVAL_MIN: '0' };
  const out = runHook('user-prompt-submit', { session_id: 'k3', prompt: 'implement the widget and its tests' }, env);
  assert.match(out.hookSpecificOutput.additionalContext, /reqall:intend/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /Reqall updates/);
});

test('REQALL_POLL_INTERVAL_MIN throttles the poll instruction', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_INTENT_INTERVAL_MIN: '0', REQALL_POLL_INTERVAL_MIN: '30', REQALL_API_KEY: '' };
  // A pollable subscription needs a verified project identity.
  runHook('reqall-track', { session_id: 't1', tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: 'TestProj' }, tool_response: { ok: true, data: { project: { id: 7, name: 'TestProj' } } } }, env);
  runHook('reqall-track', { session_id: 't1', tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 7 }, tool_response: { ok: true, data: { subscription: { project_id: 7 } } } }, env);
  assert.match(runHook('user-prompt-submit', { session_id: 't1', prompt: 'hi' }, env).hookSpecificOutput.additionalContext, /poll_subscriptions/);
  assert.equal(runHook('user-prompt-submit', { session_id: 't1', prompt: 'hi' }, env), null, 'throttled');
});

test('reqall-track counts an upsert_link repair toward reconciliation, so the verification pass clears the intent', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '0', REQALL_IDLE_PERSIST_INTERVAL_MIN: '0' };
  runHook('reqall-track', { session_id: 'l1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'spec', title: 'SPEC: Intent flow' }, tool_response: [{ type: 'text', text: specResponse }] }, env);
  assert.equal(runHook('stop', { session_id: 'l1', stop_hook_active: false }, env).decision, 'block');
  // The inline link failed; persist repaired it with upsert_link as the skill says.
  runHook(
    'reqall-track',
    { session_id: 'l1', tool_name: 'mcp__plugin_reqall_reqall__upsert_record', tool_input: { kind: 'work', title: 'WORK: x', links: [{ target_id: 4695, relationship: 'implements' }] }, tool_response: { ok: true, data: { action: 'created', record: { id: 9003, kind: 'work', title: 'WORK: x' }, links: [{ target_id: 4695, relationship: 'implements', action: 'error', error: 'timeout' }] } } },
    env,
  );
  runHook(
    'reqall-track',
    { session_id: 'l1', tool_name: 'mcp__plugin_reqall_reqall__upsert_link', tool_input: { source_id: 9003, source_table: 'records', target_id: 4695, target_table: 'records', relationship: 'implements' }, tool_response: [{ type: 'text', text: JSON.stringify({ ok: true, data: { action: 'created', link: { id: 77, source_id: 9003, source_table: 'records', target_id: 4695, target_table: 'records', relationship: 'implements' } } }) }] },
    env,
  );
  assert.equal(runHook('stop', { session_id: 'l1', stop_hook_active: true }, env), null, 'repaired link covers the intent: no re-block');
  // A failed or unrelated link does not.
  runHook('reqall-track', { session_id: 'l2', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'spec', title: 'SPEC: Intent flow' }, tool_response: [{ type: 'text', text: specResponse }] }, env);
  assert.equal(runHook('stop', { session_id: 'l2', stop_hook_active: false }, env).decision, 'block');
  runHook('reqall-track', { session_id: 'l2', tool_name: 'mcp__Reqall__upsert_link', tool_input: { source_id: 1, source_table: 'records', target_id: 4695, target_table: 'records', relationship: 'implements' }, tool_response: { ok: false, error: 'forbidden' } }, env);
  runHook('reqall-track', { session_id: 'l2', tool_name: 'mcp__Reqall__upsert_link', tool_input: { source_id: 1, source_table: 'records', target_id: 4695, target_table: 'records', relationship: 'related' }, tool_response: { ok: true, data: { action: 'created', link: { id: 78, source_id: 1, target_id: 4695, relationship: 'related' } } } }, env);
  // A project whose id collides with the intent's, or a self-link, is not coverage either.
  runHook('reqall-track', { session_id: 'l2', tool_name: 'mcp__Reqall__upsert_link', tool_input: { source_id: 1, source_table: 'records', target_id: 4695, target_table: 'projects', relationship: 'implements' }, tool_response: { ok: true, data: { action: 'created', link: { id: 79, source_id: 1, target_id: 4695, target_table: 'projects', relationship: 'implements' } } } }, env);
  runHook('reqall-track', { session_id: 'l2', tool_name: 'mcp__Reqall__upsert_link', tool_input: { source_id: 4695, source_table: 'records', target_id: 4695, target_table: 'records', relationship: 'implements' }, tool_response: { ok: true, data: { action: 'created', link: { id: 80, source_id: 4695, target_id: 4695, relationship: 'implements' } } } }, env);
  assert.equal(runHook('stop', { session_id: 'l2', stop_hook_active: true }, env).decision, 'block', 'failed, non-covering, cross-table, or self links leave the intent owed');
});

test('reqall-track binds the subscription name whichever tracker lands second (the hook runs async)', () => {
  const data = dataDir();
  const dir = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_INTENT_INTERVAL_MIN: '0', REQALL_API_KEY: '' };
  runHook('user-prompt-submit', { session_id: 'ao1', cwd: dir, prompt: 'work in project_name=acme/one please, add the parser' }, env);
  // subscribe_project's tracker finishes before upsert_project's.
  runHook('reqall-track', { session_id: 'ao1', cwd: dir, tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 11, subscriber: 'ao1' }, tool_response: { ok: true, data: { subscription: { project_id: 11 } } } }, env);
  runHook('reqall-track', { session_id: 'ao1', cwd: dir, tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: 'acme/one' }, tool_response: { ok: true, data: { project: { id: 11, name: 'acme/one' } } } }, env);
  const ctx = runHook('user-prompt-submit', { session_id: 'ao1', cwd: dir, prompt: 'now switch to project_name=acme/two and add the lexer' }, env).hookSpecificOutput.additionalContext;
  assert.match(ctx, /unsubscribe_project with project_id=11/, 'binding name known despite the reversed order');
  assert.doesNotMatch(ctx, /poll_subscriptions/);
});

test('OAuth mode: unknown subscription identity rebinds across prompt and session restart', () => {
  const data = dataDir();
  const cwd = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_WORKSPACE_ROOT: cwd, REQALL_API_KEY: '', REQALL_POLL_INTERVAL_MIN: '0' };
  const input = { session_id: 'unknown-sub', cwd };
  const trackProject = (id, name) => runHook('reqall-track', {
    ...input, tool_name: 'mcp__Reqall__upsert_project', tool_input: { name },
    tool_response: { ok: true, data: { project: { id, name } } },
  }, env);
  trackProject(17, 'old/name');
  trackProject(99, '.user');
  runHook('reqall-track', {
    ...input, tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 17, subscriber: input.session_id },
    tool_response: { ok: true, data: { subscription: { project_id: 17 } } },
  }, env);
  const state = () => JSON.parse(readFileSync(join(data, 'state-unknown-sub'), 'utf8'));
  assert.equal(state().subscribed_project_name, undefined, 'interleaved upsert leaves the subscription identity unknown');
  const ctx = runHook('user-prompt-submit', { ...input, prompt: 'project_name=new/name' }, env).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /poll_subscriptions/, 'never poll an unvalidated subscription');
  assert.match(ctx, /unsubscribe_project with project_id=17/);
  assert.doesNotMatch(ctx, /undefined/);
  assert.match(ctx, /unknown/);
  assert.match(ctx, /name="new\/name"/);
  assert.equal(state().project_id, undefined);
  assert.equal(state().prompt_project, 'new/name');
  assert.equal(state().subscribed_project_id, 17, 'keep the old cursor identity for release');
  for (const source of ['startup', 'compact']) {
    const context = runHook('session-start', { ...input, source }, env).hookSpecificOutput.additionalContext;
    assert.match(context, /project_name=new\/name/);
    assert.match(context, /unsubscribe_project with project_id=17/);
    assert.doesNotMatch(context, /undefined/);
    assert.match(context, /unknown/);
    assert.match(context, /subscribe_project with the new project_id/);
    assert.doesNotMatch(context, /poll_subscriptions/);
  }
  trackProject(18, 'new/name');
  runHook('reqall-track', {
    ...input, tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 18, subscriber: input.session_id },
    tool_response: { ok: true, data: { subscription: { project_id: 18 } } },
  }, env);
  assert.match(runHook('user-prompt-submit', { ...input, prompt: 'ok' }, env).hookSpecificOutput.additionalContext, /poll_subscriptions .*project_id=18/);
  assert.doesNotMatch(runHook('session-start', { ...input, source: 'compact' }, env).hookSpecificOutput.additionalContext, /subscribe_project/);
});

test('OAuth mode: a later project_name= selection rebinds the subscription instead of polling the old project', () => {
  const data = dataDir();
  const dir = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PROJECT_NAME: '', REQALL_INTENT_INTERVAL_MIN: '0', REQALL_API_KEY: '' };
  runHook('user-prompt-submit', { session_id: 'rb1', cwd: dir, prompt: 'work in project_name=acme/one please, add the parser' }, env);
  runHook('reqall-track', { session_id: 'rb1', cwd: dir, tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: 'acme/one' }, tool_response: { ok: true, data: { action: 'created_or_found', project: { id: 11, name: 'acme/one' } } } }, env);
  runHook('reqall-track', { session_id: 'rb1', cwd: dir, tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 11, subscriber: 'rb1' }, tool_response: { ok: true, data: { action: 'created', subscription: { project_id: 11, subscriber: 'rb1' } } } }, env);
  let ctx = runHook('user-prompt-submit', { session_id: 'rb1', cwd: dir, prompt: 'ok' }, env).hookSpecificOutput.additionalContext;
  assert.match(ctx, /poll_subscriptions .*project_id=11/);
  // Routing a preference to .user is not a project change.
  runHook('reqall-track', { session_id: 'rb1', cwd: dir, tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: '.user' }, tool_response: { ok: true, data: { project: { id: 99, name: '.user' } } } }, env);
  ctx = runHook('user-prompt-submit', { session_id: 'rb1', cwd: dir, prompt: 'ok' }, env).hookSpecificOutput.additionalContext;
  assert.match(ctx, /poll_subscriptions .*project_id=11/, 'still bound to the selected project');
  // The selection changes: rebind, do not poll the stale binding.
  ctx = runHook('user-prompt-submit', { session_id: 'rb1', cwd: dir, prompt: 'now switch to project_name=acme/two and add the lexer' }, env).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /poll_subscriptions/);
  assert.match(ctx, /unsubscribe_project with project_id=11 and subscriber="rb1"/);
  assert.match(ctx, /subscribe_project with the new project_id/);
  assert.match(ctx, /name="acme\/two"/);
  // Compaction sees the stale binding too, instead of assuming it is current.
  const compact = runHook('session-start', { session_id: 'rb1', cwd: dir, source: 'compact' }, env).hookSpecificOutput.additionalContext;
  assert.match(compact, /project_name=acme\/two/);
  assert.match(compact, /unsubscribe_project with project_id=11/);
  // Once the model rebinds, polling resumes on the new project.
  runHook('reqall-track', { session_id: 'rb1', cwd: dir, tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: 'acme/two' }, tool_response: { ok: true, data: { project: { id: 12, name: 'acme/two' } } } }, env);
  runHook('reqall-track', { session_id: 'rb1', cwd: dir, tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 12, subscriber: 'rb1' }, tool_response: { ok: true, data: { subscription: { project_id: 12 } } } }, env);
  ctx = runHook('user-prompt-submit', { session_id: 'rb1', cwd: dir, prompt: 'ok' }, env).hookSpecificOutput.additionalContext;
  assert.match(ctx, /poll_subscriptions .*project_id=12/);
  assert.doesNotMatch(runHook('session-start', { session_id: 'rb1', cwd: dir, source: 'compact' }, env).hookSpecificOutput.additionalContext, /subscribe_project/);
});

test('OAuth mode: own-write ids are retired once the model\'s poll has delivered their self events', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_INTENT_INTERVAL_MIN: '0', REQALL_API_KEY: '' };
  // A pollable subscription needs a verified project identity.
  runHook('reqall-track', { session_id: 'rt1', tool_name: 'mcp__Reqall__upsert_project', tool_input: { name: 'TestProj' }, tool_response: { ok: true, data: { project: { id: 7, name: 'TestProj' } } } }, env);
  runHook('reqall-track', { session_id: 'rt1', tool_name: 'mcp__Reqall__subscribe_project', tool_input: { project_id: 7 }, tool_response: { ok: true, data: { subscription: { project_id: 7 } } } }, env);
  runHook('reqall-track', { session_id: 'rt1', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'todo' }, tool_response: { ok: true, data: { record: { id: 555, kind: 'todo', title: 'T' } } } }, env);
  runHook('reqall-track', { session_id: 'rt1', tool_name: 'mcp__Reqall__upsert_record', tool_input: { kind: 'todo' }, tool_response: { ok: true, data: { record: { id: 556, kind: 'todo', title: 'U' } } } }, env);
  assert.match(runHook('user-prompt-submit', { session_id: 'rt1', prompt: 'ok' }, env).hookSpecificOutput.additionalContext, /#555, #556/);
  runHook(
    'reqall-track',
    { session_id: 'rt1', tool_name: 'mcp__Reqall__poll_subscriptions', tool_input: { subscriber: 'rt1', project_id: 7 }, tool_response: [{ type: 'text', text: JSON.stringify({ ok: true, data: { results: [{ subscription: { project_id: 7 }, events: [{ action: 'record.created', record_id: 555, actor: 'self' }, { action: 'record.updated', record_id: 600, actor: 'other' }], has_more: false }] } }) }] },
    env,
  );
  let ctx = runHook('user-prompt-submit', { session_id: 'rt1', prompt: 'ok' }, env).hookSpecificOutput.additionalContext;
  assert.match(ctx, /#556/, 'undelivered own write still filtered');
  assert.doesNotMatch(ctx, /#555/, 'delivered own write retired so a later same-account edit shows');
  // A truncated page still retires what it delivered; the final page may never repeat the record.
  runHook(
    'reqall-track',
    { session_id: 'rt1', tool_name: 'mcp__Reqall__poll_subscriptions', tool_input: { subscriber: 'rt1', project_id: 7 }, tool_response: { ok: true, data: { results: [{ subscription: { project_id: 7 }, events: [{ action: 'record.created', record_id: 556, actor: 'self' }], has_more: true }] } } },
    env,
  );
  ctx = runHook('user-prompt-submit', { session_id: 'rt1', prompt: 'ok' }, env).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /#556/, 'retired on first sight even with has_more');
});
