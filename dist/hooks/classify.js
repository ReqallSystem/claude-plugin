/**
 * Stop hook — Work Classification (post-task)
 *
 * Reads the agent's session transcript and classifies the work done.
 * Outputs a prompt for the agent to persist the classification via MCP tools.
 *
 * This is type: "agent" — the output becomes instructions for the agent,
 * which has full MCP tool access to call reqall:upsert_record etc.
 */
import { loadConfig, detectProject, CLASSIFICATION_PROMPT } from '@reqall/core';
async function main() {
    try {
        // Skip if API key is not configured (setup hook handles prompting)
        if (!process.env.REQALL_API_KEY?.trim())
            process.exit(0);
        const config = loadConfig();
        const projectName = config.projectName || detectProject();
        // Read transcript from stdin
        const input = await new Promise((resolve) => {
            let data = '';
            process.stdin.on('data', (chunk) => { data += chunk; });
            process.stdin.on('end', () => resolve(data));
        });
        if (!input.trim()) {
            process.exit(0);
        }
        console.log(`[reqall] Project: ${projectName}`);
        console.log(`[reqall] Classify the work completed in this session.`);
        console.log();
        console.log(CLASSIFICATION_PROMPT);
        console.log();
        console.log(`When saving, first call reqall:upsert_project with name "${projectName}" to get the project ID, then use that project_id in reqall:upsert_record.`);
    }
    catch {
        // Non-blocking: exit cleanly on any error
        process.exit(0);
    }
}
main();
//# sourceMappingURL=classify.js.map