#!/usr/bin/env node
/**
 * @reqall/claude-plugin CLI
 *
 * Outputs the plugin root directory so Claude Code can discover
 * plugin.json, hooks, skills, and MCP server configuration.
 *
 * Usage:
 *   npx -y @reqall/claude-plugin          # print plugin directory path
 *   npx -y @reqall/claude-plugin --json   # print plugin.json with resolved paths
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// dist/src/index.js → package root is two levels up
const pluginRoot = resolve(import.meta.dirname, '..', '..');

const arg = process.argv[2];

if (arg === '--help' || arg === '-h') {
  console.log('Usage: reqall-claude-plugin [--json]');
  console.log();
  console.log('Outputs the plugin root directory for Claude Code discovery.');
  console.log();
  console.log('Options:');
  console.log('  --json   Print plugin manifest with resolved directory path');
  console.log('  --help   Show this help message');
  process.exit(0);
}

if (arg === '--json') {
  const manifest = JSON.parse(
    readFileSync(resolve(pluginRoot, 'plugin.json'), 'utf-8'),
  );
  console.log(JSON.stringify({ ...manifest, dir: pluginRoot }, null, 2));
  process.exit(0);
}

// Default: print plugin root directory
console.log(pluginRoot);
