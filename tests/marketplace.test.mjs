import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {readCatalog, renderCatalog, updateCatalog} from '../scripts/check-marketplace.mjs';
import {main} from '../packages/core/cli.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const module = fileURLToPath(new URL('../packages/marketplace/index.mjs', import.meta.url));
const entry = (id = 'example') => ({
  schemaVersion: 1, id, name: 'Example', summary: 'A test plugin.', category: 'tools', apiVersion: 1,
  license: 'MIT', authors: [{name: 'Contributor', url: 'https://github.com/contributor'}],
  requires: [], optionalRequires: [], extends: [], dependencies: {}, peerDependencies: {},
  source: {type: 'github', repository: 'https://github.com/contributor/example', commit: 'a'.repeat(40), path: 'index.mjs', manifest: 'plugin.json'}
});
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-marketplace-'));
  fs.mkdirSync(path.join(directory, 'marketplace/entries'), {recursive: true});
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
function write(directory, value, filename = value.id + '.json') {
  fs.writeFileSync(path.join(directory, 'marketplace/entries', filename), JSON.stringify(value));
}
function builtin(directory, value = entry()) {
  value.source = {type: 'builtin', path: 'packages/example', package: '@example/plugin'};
  fs.mkdirSync(path.join(directory, 'packages/example'), {recursive: true});
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({license: 'MIT'}));
  fs.writeFileSync(path.join(directory, 'packages/example/package.json'), JSON.stringify({name: '@example/plugin', version: '1.0.0', exports: './index.mjs'}));
  fs.writeFileSync(path.join(directory, 'packages/example/plugin.json'), JSON.stringify({name: value.id, apiVersion: value.apiVersion, requires: value.requires, optionalRequires: value.optionalRequires, extends: value.extends}));
  fs.writeFileSync(path.join(directory, 'packages/example/index.mjs'), 'throw Error("Catalog validation must never execute this file");');
  write(directory, value);
  return value;
}

test('catalog validation only reads builtin manifests and external metadata', t => {
  const directory = fixture(t);
  builtin(directory);
  write(directory, entry('remote-example'));
  const catalog = readCatalog(directory);
  assert.deepEqual(catalog.plugins.map(plugin => plugin.id), ['example', 'remote-example']);
  assert.equal(catalog.plugins[0].version, '1.0.0');
  assert.equal(catalog.plugins[1].source.commit, 'a'.repeat(40));
  assert.equal(catalog.plugins[1].version, undefined);
});

test('catalog rejects unsafe URLs, mutable references and traversing source paths', t => {
  const directory = fixture(t);
  const cases = [
    value => { value.authors[0].url = 'javascript:alert(1)'; },
    value => { value.authors[0].url = 'https://user:secret@github.com/user'; },
    value => { value.authors[0].url = 'https://github.com/\nuser'; },
    value => { value.source.repository = 'https://github.com.evil.example/user/repo'; },
    value => { value.source.repository = 'https://github.com/user/repo/tree/main'; },
    value => { value.source.commit = 'main'; },
    value => { value.source.commit = 'v1.0.0'; },
    value => { value.source.commit = 'a'.repeat(7); },
    value => { value.source.path = '../index.mjs'; },
    value => { value.source.path = '/index.mjs'; },
    value => { value.source.path = 'plugins/../../index.mjs'; },
    value => { value.source.path = '%2e%2e/index.mjs'; },
    value => { value.source.path = 'plugins\\index.mjs'; },
    value => { value.source.manifest = '../plugin.json'; },
    value => { value.source.manifest = 'plugin.mjs'; },
    value => { delete value.source.manifest; }
  ];
  for (const change of cases) {
    const value = entry(); change(value); write(directory, value);
    assert.throws(() => readCatalog(directory), Error, JSON.stringify(value));
  }
});

test('catalog rejects duplicate ids, missing dependency references and cycles', t => {
  const directory = fixture(t);
  write(directory, entry());
  write(directory, entry(), 'second.json');
  assert.throws(() => readCatalog(directory), /Duplicate plugin id/);
  fs.rmSync(path.join(directory, 'marketplace/entries/second.json'));
  for (const field of ['requires', 'optionalRequires', 'extends']) {
    write(directory, {...entry(), [field]: ['missing']});
    assert.throws(() => readCatalog(directory), /Missing dependency entry/);
    write(directory, {...entry(), [field]: ['example']});
    assert.throws(() => readCatalog(directory), /Cyclic plugin dependency/);
  }
  write(directory, {...entry(), requires: ['second']});
  write(directory, {...entry('second'), optionalRequires: ['example']});
  assert.throws(() => readCatalog(directory), /Cyclic plugin dependency/);
  write(directory, {...entry('second'), extends: ['third']});
  write(directory, {...entry('third'), optionalRequires: ['example']});
  assert.throws(() => readCatalog(directory), /Cyclic plugin dependency/);
});

test('builtin catalog declarations must match the authoritative runtime manifest', t => {
  const directory = fixture(t);
  builtin(directory);
  const manifest = {name: 'example', apiVersion: 1, requires: [], optionalRequires: [], extends: []};
  const filename = path.join(directory, 'packages/example/plugin.json');
  for (const [field, value] of [['name', 'different'], ['apiVersion', 2], ['requires', ['base']], ['optionalRequires', ['base']], ['extends', ['base']]]) {
    fs.writeFileSync(filename, JSON.stringify({...manifest, [field]: value}));
    assert.throws(() => readCatalog(directory), /must match plugin.json/);
  }
  fs.writeFileSync(filename, JSON.stringify(manifest));
  const overlap = {...entry(), requires: ['base'], extends: ['base']};
  write(directory, overlap);
  assert.throws(() => readCatalog(directory), /exactly one/);
});

test('catalog derives reverse dependents and distinguishes dependency and inheritance edges', t => {
  const directory = fixture(t);
  write(directory, entry('base'));
  write(directory, {...entry('consumer'), requires: ['base']});
  write(directory, {...entry('integration'), optionalRequires: ['base']});
  write(directory, {...entry('derived'), extends: ['base']});
  const catalog = readCatalog(directory);
  assert.deepEqual(catalog.plugins.find(plugin => plugin.id === 'base').dependents, {requiredBy: ['consumer'], optionalFor: ['integration'], extendedBy: ['derived']});
  const markdown = renderCatalog(catalog);
  assert.match(markdown, /p_consumer -- 必需 --> p_base/);
  assert.match(markdown, /p_integration -\. 可选 \.-> p_base/);
  assert.match(markdown, /p_derived -- 继承 --> p_base/);
  assert.ok(markdown.includes('/blob/' + 'a'.repeat(40) + '/plugin.json'));
});

test('builtin entries must match actual package dependencies and stay inside repository', t => {
  const directory = fixture(t), value = builtin(directory);
  value.dependencies = {'some-library': '^1.0.0'}; write(directory, value);
  assert.throws(() => readCatalog(directory), /dependencies must match/);
  value.dependencies = {}; value.peerDependencies = {'@agent-blog/core': '^0.1.0'}; write(directory, value);
  assert.throws(() => readCatalog(directory), /peerDependencies must match/);
  value.peerDependencies = {}; value.source.path = '../example'; write(directory, value);
  assert.throws(() => readCatalog(directory), /builtin source must be a package directory/);
  value.source.path = 'packages/example'; write(directory, value);
  const outside = fixture(t);
  fs.writeFileSync(path.join(outside, 'entry.mjs'), 'export default {}');
  fs.rmSync(path.join(directory, 'packages/example/index.mjs'));
  fs.symlinkSync(path.join(outside, 'entry.mjs'), path.join(directory, 'packages/example/index.mjs'));
  assert.throws(() => readCatalog(directory), /expected a regular file/);
});

test('generated catalog is deterministic and check mode detects stale files without editing', t => {
  const directory = fixture(t);
  write(directory, entry('z-last'));
  write(directory, {...entry('a-first'), name: '<b>Unsafe | markup</b>'});
  assert.deepEqual(updateCatalog(directory), {plugins: 2, checked: false});
  const readme = path.join(directory, 'marketplace/README.md');
  const original = fs.readFileSync(readme, 'utf8');
  assert.ok(original.includes('/blob/' + 'a'.repeat(40) + '/index.mjs'));
  assert.match(original, /&lt;b&gt;Unsafe &#124; markup&lt;\/b&gt;/);
  assert.ok(original.indexOf('[a-first]') < original.indexOf('[z-last]'));
  updateCatalog(directory);
  assert.equal(fs.readFileSync(readme, 'utf8'), original);
  assert.deepEqual(updateCatalog(directory, {checkOnly: true}), {plugins: 2, checked: true});
  fs.writeFileSync(readme, 'stale');
  assert.throws(() => updateCatalog(directory, {checkOnly: true}), /Stale generated catalog/);
  assert.equal(fs.readFileSync(readme, 'utf8'), 'stale');
  updateCatalog(directory);
  const machineCatalog = path.join(directory, 'packages/marketplace/catalog.json');
  fs.writeFileSync(machineCatalog, '{}\n');
  assert.throws(() => updateCatalog(directory, {checkOnly: true}), /Stale generated catalog: packages\/marketplace\/catalog.json/);
  assert.equal(fs.readFileSync(machineCatalog, 'utf8'), '{}\n');
  updateCatalog(directory);
  write(directory, {...entry('a-first'), summary: 'Updated source metadata'});
  assert.throws(() => updateCatalog(directory, {checkOnly: true}), /Stale generated catalog/);
});

test('marketplace is a removable offline plugin with discoverable JSON commands', async t => {
  assert.equal(updateCatalog(repository, {checkOnly: true}).checked, true);
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, 'content'));
  fs.writeFileSync(path.join(directory, 'blog.json'), JSON.stringify({version: 1, title: 'Catalog test', plugins: [module]}));
  const schema = await main(['schema', '--site', directory]);
  assert.equal(schema.commands.find(command => command.name === 'marketplace-list').flags.query.type, 'string');
  assert.deepEqual(schema.commands.find(command => command.name === 'marketplace-get').arguments, ['id']);
  const matches = await main(['marketplace-list', '--query', '说说', '--category', 'content', '--site', directory]);
  assert.deepEqual(matches.plugins.map(plugin => plugin.id), ['notes']);
  const notes = await main(['marketplace-get', 'notes', '--site', directory]);
  assert.equal(notes.source.package, '@agent-blog/notes');
  assert.deepEqual(notes.optionalRequires, ['editor']);
  assert.deepEqual(notes.extends, []);
  const editor = await main(['marketplace-get', 'editor', '--site', directory]);
  assert.ok(editor.dependents.optionalFor.includes('notes'));
  assert.ok(editor.dependents.requiredBy.includes('editor-agent'));
  assert.deepEqual(editor.dependents.extendedBy, []);
  await assert.rejects(main(['marketplace-get', 'missing', '--site', directory]), {code: 'NOT_FOUND'});
  await main(['plugin', 'disable', module, '--site', directory]);
  const disabled = await main(['schema', '--site', directory]);
  assert.equal(disabled.commands.some(command => command.name === 'marketplace-list'), false);
});
