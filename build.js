import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/index.js'],
    bundle: true,
    format: 'esm',
    outfile: 'dist/risto.esm.js',
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/index.js'],
    bundle: true,
    format: 'iife',
    globalName: 'Risto',
    outfile: 'dist/risto.global.js',
    sourcemap: true,
    minify: true,
  }),
  // The demo's RevenueCat integration (demo/billing.js) imports the SDK by
  // bare specifier, which only a bundler can resolve — this produces the
  // real ES module demo/index.html loads via a plain <script type="module">.
  build({
    entryPoints: ['demo/billing.js'],
    bundle: true,
    format: 'esm',
    outfile: 'demo/billing.bundle.js',
    sourcemap: true,
  }),
]);

console.log('Built dist/risto.esm.js, dist/risto.global.js, and demo/billing.bundle.js');
