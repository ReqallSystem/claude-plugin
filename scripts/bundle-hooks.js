/**
 * Bundle each hook script into a self-contained .mjs file using esbuild.
 * This inlines @reqall/core since Claude Code copies plugins without node_modules.
 */
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const hooksDir = join(import.meta.dirname, '..', 'dist', 'hooks');
const outDir = join(import.meta.dirname, '..', 'dist', 'hooks');

const hookFiles = readdirSync(hooksDir).filter(f => f.endsWith('.js') && f !== 'hooks.json');

for (const file of hookFiles) {
  const name = file.replace('.js', '.mjs');
  await build({
    entryPoints: [join(hooksDir, file)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(outDir, name),
    external: [],
  });
  console.log(`Bundled: ${name}`);
}
