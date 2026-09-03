# Plugin Evaluation — August 2026

Gap analysis of the `reqall` Claude Code plugin (v2026.8.3) against current
Claude Code plugin capabilities (checked against code.claude.com docs,
2026-08-16).

**Overall: the plugin is in good shape.** The 2026-08-03 modernization holds
up — hook schema usage, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`,
skill frontmatter spellings (`when_to_use`, `argument-hint`,
`disable-model-invocation`), Stop-hook loop guard, committed `dist/`, and the
test suite (13/13 passing, `dist/` in sync with `src/`) are all correct and
current. The items below are the remaining gaps, ordered by priority.

> **Implementation status (2026-08-16, v2026.8.4):** items 1–6 and 9–12 are
> implemented on this branch. Two findings were amended after verifying
> against the hooks reference: PostCompact output is ignored by Claude Code —
> post-compaction re-injection is instead covered by `SessionStart` re-firing
> with `source: compact`, which the existing matcher-less hook already
> handles (item 6); and SubagentStop JSON output cannot inject context into
> the parent conversation, so that hook was rewritten as a side-effect-only
> activity marker instead of being filtered/throttled (item 5). Item 4's
> activity gate became a two-tier cadence (standard interval with activity,
> longer idle interval without) after a review note correctly observed that
> chat-only sessions can still produce persistable decisions. Items 7, 8,
> and 13 remain open follow-ups.

---

## P1 — Broken or silently inert

### 1. `npx @reqall/claude-plugin --json` crashes (confirmed bug)
`src/index.ts:33` reads `plugin.json` from the package root, but the manifest
moved to `.claude-plugin/plugin.json` in commit `2f29dce`. The `--json` path
throws `ENOENT` and exits 1 (reproduced). Either point the read at
`.claude-plugin/plugin.json` or drop the npm CLI entirely — the plugin now
installs from the git marketplace, so the `bin` discovery mechanism is
vestigial. Tracked as Reqall record #3972.

### 2. Hard-coded MCP tool prefix breaks pre-approval on non-CLI surfaces
Every skill's `allowed-tools` and the `reqall-documenter` agent's `tools`
list name tools as `mcp__plugin_reqall_reqall__*`. That prefix is only
minted when the plugin's own MCP server config connects (CLI installs).
On surfaces where Reqall is instead reached through a claude.ai connector,
the server surfaces as a different name (e.g. `mcp__Reqall__*`), so:

- skill pre-approval silently grants nothing (permission prompts return), and
- the documenter agent's tool allowlist contains no reachable Reqall tools,
  making the background documenter unable to write records.

Agent `tools` entries support server-level wildcards (`mcp__<server>__*`);
listing both prefixes (`mcp__plugin_reqall_reqall__*` and `mcp__Reqall__*`)
is a cheap defensive fix. Same for skills' `allowed-tools`.

---

## P2 — Capability gaps worth adopting

### 3. Use `userConfig` in plugin.json instead of manual env exports
The manifest now supports a `userConfig` block: users are prompted for values
at enable time, `sensitive: true` masks secrets, values substitute as
`${user_config.KEY}` in MCP configs and export as `CLAUDE_PLUGIN_OPTION_<KEY>`
env vars to hook processes. `REQALL_API_KEY` / `REQALL_URL` are exactly this
use case — today the README tells users to `export` them by hand, which is
the pre-2026 pattern and a real onboarding hurdle.

*Implemented:* `userConfig` with a sensitive, required `api_key` and a
`server_url` defaulting to `https://www.reqall.net`, substituted as
`${user_config.*}` in `.mcp.json`. The originally suggested env-var fallback
was dropped: the docs confirm substitution cannot nest with
`${VAR:-default}` syntax, so plugin config is now the single source for the
MCP connection (headless/CI environments seed it via `pluginConfigs` in
`settings.json`).

### 4. Stop hook blocks sessions that did no work
`src/hooks/stop.ts` blocks on every un-throttled Stop, even when the session
was pure Q&A / read-only — the model then has to answer "Nothing to persist."
(observed live during this evaluation).

*Implemented as a two-tier cadence rather than a binary gate:* `post-tool.ts`
and `subagent-stop.ts` touch an `activity-<session>` marker; sessions with
the marker block on `REQALL_PERSIST_INTERVAL_MIN` (30) and the marker clears
once a persist is forced, while sessions without it still block on the longer
`REQALL_IDLE_PERSIST_INTERVAL_MIN` (120, `0` disables). A binary gate would
have silently skipped chat-only sessions that produce decisions, specs, or
plans without tool use (credit: PR #6 review); the idle tier keeps those
captured at a gentler cadence.

### 5. SubagentStop output is inert — rewritten as an activity marker
Original finding: the hook fires unthrottled for every subagent, including
`reqall-documenter` itself. Verifying against the hooks reference surfaced a
stronger problem: SubagentStop JSON output supports only block decisions —
`additionalContext` from this event is ignored, so the previous
instruction-emitting hook did nothing at all. *Implemented:* the hook is now
side-effect-only — it records session activity (so plans and findings from
subagents get the standard persist cadence) and prints nothing; the
`async: true` flag keeps it off the critical path. Plan-output persistence
is handled by the persist skill's session scan, as before.

### 6. Context re-injection after compaction — already covered, corrected
Original recommendation was a PostCompact hook. Verifying against the hooks
reference: PostCompact's hook output is ignored (it cannot inject context),
but `SessionStart` re-fires after compaction with `source: compact` — and
this plugin's SessionStart hook has no matcher, so it already re-injects
project context post-compaction. No code change needed; documented in the
README instead.

### 7. Consider UserPromptSubmit for per-task context
> **Implemented 2026-09-03 (v2026.9.1, reqall_net GH #102):** a throttled
> `UserPromptSubmit` hook (`REQALL_INTENT_INTERVAL_MIN`, default 15) nudges
> the new `reqall:intend` skill, alongside an unthrottled `ExitPlanMode`
> PostToolUse trigger and an `upsert_record` PostToolUse tracker that feeds
> intent ids to the Stop/PreCompact persist prompt.

`UserPromptSubmit` can inject `additionalContext` per user prompt. A
throttled hook suggesting a Reqall search scoped to the *current* prompt
would target context better than the one-shot SessionStart instruction,
especially in long sessions that drift across topics. Optional — weigh the
noise cost; the throttle default should be generous (e.g. 15+ min).

### 8. Nudge-based documentation could become deterministic (agent-type hooks)
Hooks now support `type: "prompt"` and `type: "agent"` handlers in addition
to `type: "command"`. Today post-tool.js emits advice the main model may
ignore. A `type: "agent"` PostToolUse hook could *run* the documenter
directly, making incremental documentation deterministic rather than
advisory. Trade-off is token cost per firing; if adopted, keep the throttle
and consider `model: haiku` on the handler.

---

## P3 — Polish and alignment

### 9. plugin.json metadata
Missing recommended marketplace fields: `$schema`
(`https://json.schemastore.org/claude-code-plugin-manifest.json`),
`displayName` ("Reqall"), `homepage`, `repository`. One-line additions that
improve the plugin-manager listing.

### 10. MCP config filename
Canonical location is `.mcp.json` at plugin root; `mcp-servers.json` works
only because plugin.json references it explicitly. Renaming is cosmetic but
removes a "why is this nonstandard?" speed bump for contributors.

### 11. Skill polish
- `skills/document/SKILL.md` is documented as agent-only — add
  `user-invocable: false` so it stops cluttering the `/` menu (keep
  `context`/`persist` invocable; they're useful manually).
- `review` could take an `argument-hint: "[kind]"` since it already supports
  kind filtering.

### 12. Agent polish (`agents/reqall-documenter.md`)
- No `model` pin — it inherits the parent session's model, which is
  expensive for a classification/write task. `model: haiku` fits.
- Add `maxTurns` (e.g. 10) as a runaway guard.

### 13. No eval suite
`claude plugin eval` (early access) runs cases in isolated sessions with
regex / tool_used / llm graders and a with/without-plugin ablation arm. This
plugin's behavior is almost entirely prompt-mediated (hooks emit instructions
the model must follow), which is exactly the regression class evals catch.
A small `evals/` suite — "SessionStart leads to a context search",
"Stop leads to persist or 'Nothing to persist'" — would future-proof it.

### 14. Not applicable (checked, intentionally skipped)
LSP servers, output styles, themes, monitors, channels, workflows, `bin/`
executables, plugin `settings.json` — none fit this plugin's purpose today.
`commands/` vs `skills/`: already correctly on `skills/`.

---

## What's already aligned (no action)

- `.claude-plugin/plugin.json` location and required fields
- `hooks/hooks.json` structure, matchers, `timeout`, `statusMessage`,
  `async: true` on PostToolUse
- `hookSpecificOutput.additionalContext` usage on SessionStart / PreToolUse /
  PostToolUse / SubagentStop / PreCompact; Stop's top-level
  `decision: "block"` + `stop_hook_active` guard
- `${CLAUDE_PLUGIN_ROOT}` in hook commands; `CLAUDE_PLUGIN_DATA` for
  throttle state
- Skill frontmatter spellings: `when_to_use` (underscore), `argument-hint`,
  `allowed-tools`, `disable-model-invocation` on user-driven skills
- Env-var expansion in MCP `url`/`headers` (`${REQALL_URL:-…}`,
  `${REQALL_API_KEY}`)
- Committed `dist/` for git-based install; `npm test` = build + 13 hook
  tests, all passing and in sync
