/**
 * headersHelper for the Reqall MCP server.
 *
 * Claude Code runs this on every connection (and again after a 401/403) and
 * merges the JSON object it prints into the request headers.
 *
 *   REQALL_API_KEY set   -> {"Authorization": "Bearer <key>"}  static key auth,
 *                           for headless and CI use where no browser exists.
 *   REQALL_API_KEY unset -> {}                                  Claude Code sees
 *                           the server's 401 challenge and runs OAuth instead.
 *
 * Emitting an Authorization header disables the OAuth fallback for the
 * server, which is why the key must be omitted entirely rather than sent
 * empty. This cannot read ${user_config.*}: helpers run through a shell and
 * Claude Code refuses to substitute plugin config into them.
 * See https://code.claude.com/docs/en/mcp#headersHelper
 */
const key = process.env.REQALL_API_KEY?.trim();
const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
process.stdout.write(JSON.stringify(headers));
