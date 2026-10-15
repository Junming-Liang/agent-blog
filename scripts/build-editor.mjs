import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import runtime from '@agent-blog/editor/runtime' with {type: 'json'};

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = new Map([['editor', {directory: path.join(root, 'packages/editor'), entry: path.join(root, 'packages/editor/browser.mjs')}]]);
for (const name of fs.readdirSync(path.join(root, 'packages')).sort()) {
  const directory = path.join(root, 'packages', name);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (!manifest.agentBlog?.browser) continue;
  const entry = path.resolve(directory, manifest.agentBlog.browser);
  if (!entry.startsWith(directory + path.sep) || !fs.statSync(entry).isFile() || packages.has(name)) throw Error(`Invalid browser entry: ${name}`);
  packages.set(name, {directory, entry});
}
const targets = process.argv.slice(2);
for (const name of targets) if (!packages.has(name)) throw Error(`Unknown browser package: ${name}`);
for (const name of targets.length ? [...new Set(targets)] : packages.keys()) {
  const {directory, entry} = packages.get(name);
  const outdir = path.join(directory, 'public/bundle');
  const editor = name === 'editor';
  const entryPoints = editor ? {editor: entry, ...Object.fromEntries(Object.entries(runtime.modules).map(([specifier, file]) => [`runtime/${file}`, `runtime:${specifier}`]))} : {browser: entry};
  // Host entry points share one module graph; feature bundles import that public runtime.
  const result = await build({
    entryPoints, outdir, bundle: true, splitting: true, minify: true, format: 'esm', target: ['es2022'],
    legalComments: 'inline', chunkNames: 'chunks/[name]-[hash]', metafile: true, write: false,
    external: editor ? [] : Object.keys(runtime.modules),
    plugins: editor ? [{name: 'editor-runtime', setup(builder) {
      builder.onResolve({filter: /^runtime:/}, args => ({path: args.path.slice('runtime:'.length), namespace: 'editor-runtime'}));
      builder.onLoad({filter: /.*/, namespace: 'editor-runtime'}, args => ({contents: `export * from ${JSON.stringify(args.path)};`, resolveDir: directory, loader: 'js'}));
    }}] : []
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (editor && inputs.some(input => /node_modules\/(?:@codemirror\/lang-|@lezer\/(?:markdown|javascript|python|html|css)\/)/.test(input))) throw Error('Editor runtime must not include feature language grammars.');
  if (!editor && inputs.some(input => Object.keys(runtime.modules).some(specifier => input.includes(`node_modules/${specifier}/`)))) throw Error(`${name} bundled a shared editor runtime module.`);
  fs.rmSync(outdir, {recursive: true, force: true});
  for (const output of result.outputFiles) {
    fs.mkdirSync(path.dirname(output.path), {recursive: true});
    fs.writeFileSync(output.path, output.contents);
  }
  console.log(`Built ${name}: ${path.relative(root, outdir)}`);
}
