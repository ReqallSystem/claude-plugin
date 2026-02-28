/**
 * SubagentStop hook — Plan Capture (post-plan)
 *
 * Triggered when a planning subagent completes. Reads the plan transcript
 * and prompts the agent to persist it as a spec record.
 *
 * This is type: "agent" — the output becomes instructions for the agent,
 * which has full MCP tool access to call reqall:upsert_record etc.
 */
import { loadConfig, detectProject } from '@reqall/core';

async function main() {
  try {
    // Skip if API key is not configured (setup hook handles prompting)
    if (!process.env.REQALL_API_KEY?.trim()) process.exit(0);

    const config = loadConfig();
    const projectName = config.projectName || detectProject();

    // Read plan transcript from stdin
    const input = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
    });

    if (!input.trim()) {
      // Empty transcript — skip silently
      process.exit(0);
    }

    console.log(`[reqall] Project: ${projectName}`);
    console.log(`[reqall] A planning subagent just completed. Save this plan as a specification record.`);
    console.log();
    console.log(`Instructions:`);
    console.log(`1. Extract a concise title for this plan (prefix with "ARCH:" or "PLAN:" as appropriate)`);
    console.log(`2. Call reqall:upsert_project with name "${projectName}" to get the project ID`);
    console.log(`3. Call reqall:upsert_record with kind="spec", status="open", the title, and the full plan as the body`);
    console.log(`4. If this plan relates to existing records, create links via reqall:upsert_link`);
    console.log();
    console.log(`Plan transcript:`);
    console.log(input);
  } catch {
    // Non-blocking: exit cleanly on any error
    process.exit(0);
  }
}

main();
