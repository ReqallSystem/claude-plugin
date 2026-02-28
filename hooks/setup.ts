/**
 * UserPromptSubmit hook — Auth Setup
 *
 * With Claude Code native MCP OAuth, authentication is handled automatically.
 * REQALL_API_KEY is only needed for manual/fallback auth.
 * Exits silently in all cases so other hooks proceed normally.
 */

async function main() {
  try {
    // With Claude Code native MCP auth, REQALL_API_KEY is optional.
    // Claude Code will use its built-in OAuth flow via .mcp.json.
    // If the user has configured a manual key, it will be used as a fallback.
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
