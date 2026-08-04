#!/usr/bin/env node
/** PreToolUse (Write|Edit|NotebookEdit): surface file-specific records before modification. */
import { emitContext, projectName, readStdin } from './common.js';
const input = readStdin();
const toolInput = input.tool_input ?? {};
const filePath = toolInput.file_path ||
    toolInput.notebook_path;
if (filePath) {
    const name = projectName(input);
    emitContext('PreToolUse', `[reqall] Before modifying ${filePath}, call reqall:search with query="${filePath}" ` +
        `and project_name="${name}" to check for relevant records (specs, open issues, ` +
        `architecture decisions). If results are found, consider them before proceeding.`);
}
//# sourceMappingURL=pre-tool.js.map