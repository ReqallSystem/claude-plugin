/**
 * UserPromptSubmit hook — API Key Setup
 *
 * Checks if REQALL_API_KEY is configured. If not, instructs the agent
 * to prompt the user for their API key and install it at the user level.
 *
 * Exits silently when the key is already present so other hooks
 * (context retrieval, etc.) proceed normally.
 */
async function main() {
    try {
        const apiKey = process.env.REQALL_API_KEY;
        if (apiKey && apiKey.trim()) {
            // Key is present — nothing to do
            process.exit(0);
        }
        const shell = process.env.SHELL || '';
        // Determine the appropriate profile file based on the user's shell
        let profilePath;
        let exportSyntax;
        if (shell.includes('zsh')) {
            profilePath = '~/.zshrc';
            exportSyntax = 'export REQALL_API_KEY="<key>"';
        }
        else if (shell.includes('fish')) {
            profilePath = '~/.config/fish/config.fish';
            exportSyntax = 'set -Ux REQALL_API_KEY <key>';
        }
        else {
            // Default to bash
            profilePath = '~/.bashrc';
            exportSyntax = 'export REQALL_API_KEY="<key>"';
        }
        // Output setup instructions for the agent
        console.log(`[reqall] REQALL_API_KEY is not configured.`);
        console.log();
        console.log(`The Reqall plugin requires an API key to function.`);
        console.log(`Ask the user for their Reqall API key. If they don't have one, they can sign up at https://reqall.net to obtain one.`);
        console.log();
        console.log(`Once the user provides the key, install it at the user level:`);
        console.log();
        console.log(`1. Append the following line to ${profilePath}:`);
        console.log(`   ${exportSyntax}`);
        console.log(`   (Replace <key> with the actual API key the user provides.)`);
        console.log();
        console.log(`2. After writing the file, tell the user to start a new terminal session (or run "source ${profilePath}") for the key to take effect.`);
        console.log();
        console.log(`IMPORTANT: Do NOT proceed with other reqall operations until the API key is configured. Skip any reqall search or classification steps for this session.`);
    }
    catch {
        process.exit(0);
    }
}
main();
export {};
//# sourceMappingURL=setup.js.map