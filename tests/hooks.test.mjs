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

test('stop blocks with persist instructions when work not yet persisted', () => {
  const data = dataDir();
  const out = runHook(
    'stop',
    { hook_event_name: 'Stop', session_id: 's2', stop_hook_active: false },
    { CLAUDE_PLUGIN_DATA: data },
  );
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /reqall:persist/);
  assert.match(out.reason, /TestProj/);
});

test('stop is silent when stop_hook_active is true', () => {
  const data = dataDir();
  const out = runHook(
    'stop',
    { session_id: 's3', stop_hook_active: true },
    { CLAUDE_PLUGIN_DATA: data },
  );
  assert.equal(out, null);
});

test('stop throttles repeat blocks within persist interval for same session', () => {
  const data = dataDir();
  const env = { CLAUDE_PLUGIN_DATA: data, REQALL_PERSIST_INTERVAL_MIN: '30' };
  const input = { session_id: 's4', stop_hook_active: false };
  assert.equal(runHook('stop', input, env).decision, 'block');
  assert.equal(runHook('stop', input, env), null, 'second block within interval should be suppressed');
});

test('subagent-stop saves Plan output as spec', () => {
  const out = runHook('subagent-stop', { agent_type: 'Plan', session_id: 's5' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SubagentStop');
  assert.match(out.hookSpecificOutput.additionalContext, /spec/);
  assert.match(out.hookSpecificOutput.additionalContext, /TestProj/);
});

test('subagent-stop notes other agents for later persistence', () => {
  const out = runHook('subagent-stop', { agent_type: 'general-purpose', session_id: 's6' });
  assert.match(out.hookSpecificOutput.additionalContext, /persist/i);
});

test('pre-compact instructs persist before compaction', () => {
  const out = runHook('pre-compact', { hook_event_name: 'PreCompact', session_id: 's7' });
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
