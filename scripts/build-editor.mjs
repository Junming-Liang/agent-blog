import {build} from 'esbuild';
await build({entryPoints: ['packages/editor/browser.mjs'], outfile: 'packages/editor/public/editor.js', bundle: true, minify: true, format: 'esm', target: ['es2022'], legalComments: 'inline'});
