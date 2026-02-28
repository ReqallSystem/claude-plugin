/**
 * UserPromptSubmit hook — Context Retrieval (pre-prompt)
 *
 * Reads the user's prompt from stdin and instructs the agent to search
 * reqall for relevant context using its built-in MCP access.
 *
 * This is type: "agent" — the output becomes instructions for the agent,
 * which has full MCP tool access to call reqall:search etc.
 */
import { loadConfig, detectProject } from '@reqall/core';
async function main() {
    try {
        // Skip if API key is not configured (setup hook handles prompting)
        if (!process.env.REQALL_API_KEY?.trim())
            process.exit(0);
        const config = loadConfig();
        const projectName = config.projectName || detectProject();
        const input = await new Promise((resolve) => {
            let data = '';
            process.stdin.on('data', (chunk) => { data += chunk; });
            process.stdin.on('end', () => resolve(data));
        });
        if (!input.trim())
            process.exit(0);
        const { prompt } = JSON.parse(input);
        console.log(`[reqall] Project: ${projectName}`);
        console.log(`[reqall] Search for relevant context before responding.`);
        console.log();
        console.log(`Call reqall:search with query="${prompt}", project_name="${projectName}", limit=${config.contextLimit}`);
        console.log(`If results are found, consider them as context for the user's request.`);
    }
    catch {
        process.exit(0);
    }
}
main();
//# sourceMappingURL=context.js.map