import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/risto.esm.js',
  sourcemap: true,
});

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  globalName: 'Risto',
  outfile: 'dist/risto.global.js',
  sourcemap: true,
  minify: true,
});

console.log('Built dist/risto.esm.js and dist/risto.global.js');
