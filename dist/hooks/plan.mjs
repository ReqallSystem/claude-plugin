// ../core/dist/config.js
function loadConfig() {
  return {
    apiKey: process.env.REQALL_API_KEY || void 0,
    url: process.env.REQALL_URL || "https://reqall.net",
    projectName: process.env.REQALL_PROJECT_NAME || void 0,
    contextLimit: parseInt(process.env.REQALL_CONTEXT_LIMIT || "", 10) || 5,
    recencyHours: parseInt(process.env.REQALL_RECENCY_HOURS || "", 10) || 1
  };
}

// ../core/dist/detect-project.js
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

// dist/hooks/plan.js
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
    if (!input.trim()) {
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
    process.exit(0);
  }
}
main();
