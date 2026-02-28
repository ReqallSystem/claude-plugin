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

// node_modules/@reqall/core/dist/classify.js
var CLASSIFICATION_PROMPT = `Classify the work just completed into exactly one category:

| Work type                          | kind    | status     |
|------------------------------------|---------|------------|
| Bug fix                            | issue   | resolved   |
| Architectural change               | arch    | resolved   |
| New feature request (not yet done) | todo    | open       |
| Completed feature request          | todo    | resolved   |
| New spec or plan                   | spec    | open       |
| Test scenario                      | test    | open       |
| Trivial / Q&A / unclassifiable     | \u2014       | no action  |

If the work is non-trivial, save it via reqall:upsert_record with the appropriate kind, status, and a short descriptive title.
If the work created or modified relationships between records, also call reqall:upsert_link.`;

// dist/hooks/classify.js
async function main() {
  try {
    if (!process.env.REQALL_API_KEY?.trim())
      process.exit(0);
    const config = loadConfig();
    const projectName = config.projectName || detectProject();
    const input = await new Promise((resolve) => {
      let data = "";
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
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
  } catch {
    process.exit(0);
  }
}
main();
