// node_modules/@reqall/core/dist/config.js
var DEFAULT_URL = "https://reqall.net";
var DEFAULT_CONTEXT_LIMIT = 5;
var DEFAULT_RECENCY_HOURS = 1;
function loadConfig() {
  const apiKey = process.env.REQALL_API_KEY;
  if (!apiKey) {
    throw new Error("REQALL_API_KEY environment variable is required");
  }
  return {
    apiKey,
    url: process.env.REQALL_URL || DEFAULT_URL,
    projectName: process.env.REQALL_PROJECT_NAME || void 0,
    contextLimit: parseInt(process.env.REQALL_CONTEXT_LIMIT || "", 10) || DEFAULT_CONTEXT_LIMIT,
    recencyHours: parseInt(process.env.REQALL_RECENCY_HOURS || "", 10) || DEFAULT_RECENCY_HOURS
  };
}

// node_modules/@reqall/core/dist/detect-project.js
import { execSync } from "node:child_process";
import { basename } from "node:path";
function detectProject(cwd) {
  if (process.env.REQALL_PROJECT_NAME) {
    return process.env.REQALL_PROJECT_NAME;
  }
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  } catch {
  }
  return basename(cwd || process.cwd());
}

// dist/hooks/context.js
async function main() {
  try {
    const config = loadConfig();
    const projectName = config.projectName || detectProject();
    const input = await new Promise((resolve) => {
      let data = "";
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
    });
    if (!input.trim())
      process.exit(0);
    const { prompt } = JSON.parse(input);
    console.log(`[reqall] Project: ${projectName}`);
    console.log(`[reqall] Search for relevant context before responding.`);
    console.log();
    console.log(`Call reqall:search with query="${prompt}", project_name="${projectName}", limit=${config.contextLimit}`);
    console.log(`If results are found, consider them as context for the user's request.`);
  } catch {
    process.exit(0);
  }
}
main();
