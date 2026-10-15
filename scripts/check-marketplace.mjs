#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const categories = ['content', 'rendering', 'editor', 'theme', 'integration', 'publishing', 'tools'];
const identifier = /^[a-z][a-z0-9-]*$/;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const sorted = values => [...values].sort();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const relations = {requires: 'requiredBy', optionalRequires: 'optionalFor', extends: 'extendedBy'};
function check(condition, message) { if (!condition) throw Error(message); }
function fields(value, names, label) {
  check(object(value), `${label}: expected an object.`);
  check(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), `${label}: expected fields ${names.join(', ')}.`);
}
function text(value, label, max = 200) {
  check(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), `${label}: expected a nonempty single line (up to ${max} characters).`);
}
function https(value, label) {
  text(value, label, 1000);
  let url;
  try { url = new URL(value); } catch { throw Error(`${label}: expected an HTTPS URL.`); }
  check(value.startsWith('https://') && !/[\s\\]/.test(value) && url.protocol === 'https:' && url.hostname && !url.username && !url.password, `${label}: use HTTPS without credentials.`);
}
function safePath(value, label) {
  check(typeof value === 'string' && value.length > 0 && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part)), `${label}: use a relative path without dot segments, escapes or backslashes.`);
}
function localFile(directory, relative) {
  safePath(relative, relative);
  const base = fs.realpathSync(directory), filename = path.join(base, relative);
  check(fs.existsSync(filename) && fs.lstatSync(filename).isFile(), `${relative}: expected a regular file.`);
  check(fs.realpathSync(filename).startsWith(base + path.sep), `${relative}: must stay inside the repository.`);
  return filename;
}
function dependencyMap(value, label) {
  check(object(value), `${label}: expected an npm dependency object (use {} for none).`);
  for (const [name, range] of Object.entries(value)) {
    check(packageName.test(name), `${label}: invalid npm package ${name}.`);
    text(range, `${label}.${name}`, 300);
  }
  return Object.fromEntries(sorted(Object.keys(value)).map(name => [name, value[name]]));
}
function pluginRelations(value, label) {
  const seen = new Set();
  for (const field of Object.keys(relations)) {
    check(Array.isArray(value[field]) && value[field].every(id => typeof id === 'string' && identifier.test(id)) && new Set(value[field]).size === value[field].length, `${label}: ${field} must contain unique plugin ids (use [] for none).`);
    for (const id of value[field]) {
      check(!seen.has(id), `${label}: declare ${id} in exactly one of requires, optionalRequires or extends.`);
      seen.add(id);
    }
  }
}

export function readCatalog(directory = root) {
  const entriesDirectory = path.join(directory, 'marketplace/entries');
  const filenames = sorted(fs.readdirSync(entriesDirectory));
  check(filenames.length > 0, 'The marketplace needs at least one entry.');
  const entries = [], ids = new Set();
  for (const filename of filenames) {
    check(/^[a-z][a-z0-9-]*\.json$/.test(filename), `Invalid entry filename: ${filename}.`);
    const entry = JSON.parse(fs.readFileSync(localFile(directory, 'marketplace/entries/' + filename), 'utf8'));
    fields(entry, ['schemaVersion', 'id', 'name', 'summary', 'category', 'apiVersion', 'license', 'authors', 'requires', 'optionalRequires', 'extends', 'dependencies', 'peerDependencies', 'source'], filename);
    check(entry.schemaVersion === 1 && entry.apiVersion === 1, `${filename}: this catalog supports schemaVersion 1 and apiVersion 1.`);
    check(typeof entry.id === 'string' && identifier.test(entry.id), `${filename}: invalid plugin id.`);
    check(!ids.has(entry.id), `Duplicate plugin id: ${entry.id}.`);
    ids.add(entry.id);
    check(filename === entry.id + '.json', `${filename}: filename must match plugin id ${entry.id}.`);
    text(entry.name, `${entry.id}.name`, 80);
    text(entry.summary, `${entry.id}.summary`);
    check(categories.includes(entry.category), `${entry.id}: invalid category.`);
    check(typeof entry.license === 'string' && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(entry.license), `${entry.id}: declare an SPDX license identifier.`);
    check(Array.isArray(entry.authors) && entry.authors.length > 0, `${entry.id}: declare at least one author.`);
    for (const author of entry.authors) {
      fields(author, ['name', 'url'], `${entry.id}.authors`);
      text(author.name, `${entry.id}.author.name`, 80);
      https(author.url, `${entry.id}.author.url`);
    }
    pluginRelations(entry, entry.id);
    const dependencies = dependencyMap(entry.dependencies, `${entry.id}.dependencies`);
    const peerDependencies = dependencyMap(entry.peerDependencies, `${entry.id}.peerDependencies`);
    check(object(entry.source), `${entry.id}: declare a source.`);
    let version;
    if (entry.source.type === 'builtin') {
      fields(entry.source, ['type', 'path', 'package'], `${entry.id}.source`);
      check(typeof entry.source.path === 'string' && /^packages\/[a-z][a-z0-9-]*$/.test(entry.source.path), `${entry.id}: builtin source must be a package directory.`);
      const manifest = JSON.parse(fs.readFileSync(localFile(directory, entry.source.path + '/package.json'), 'utf8'));
      const plugin = JSON.parse(fs.readFileSync(localFile(directory, entry.source.path + '/plugin.json'), 'utf8'));
      fields(plugin, ['name', 'apiVersion', ...Object.keys(relations)], `${entry.id}: plugin.json`);
      pluginRelations(plugin, `${entry.id}: plugin.json`);
      check(plugin.name === entry.id && plugin.apiVersion === entry.apiVersion, `${entry.id}: id and apiVersion must match plugin.json.`);
      for (const field of Object.keys(relations)) check(JSON.stringify(sorted(plugin[field])) === JSON.stringify(sorted(entry[field])), `${entry.id}: ${field} must match plugin.json.`);
      check(typeof entry.source.package === 'string' && packageName.test(entry.source.package) && manifest.name === entry.source.package, `${entry.id}: source.package must match package.json.`);
      text(manifest.version, `${entry.id}: package version`, 80);
      version = manifest.version;
      check(JSON.stringify(dependencies) === JSON.stringify(dependencyMap(manifest.dependencies || {}, `${entry.id}: package dependencies`)), `${entry.id}: dependencies must match package.json.`);
      check(JSON.stringify(peerDependencies) === JSON.stringify(dependencyMap(manifest.peerDependencies || {}, `${entry.id}: package peer dependencies`)), `${entry.id}: peerDependencies must match package.json.`);
      const license = manifest.license || JSON.parse(fs.readFileSync(localFile(directory, 'package.json'), 'utf8')).license;
      check(license === entry.license, `${entry.id}: license must match its package or workspace license.`);
      const exported = typeof manifest.exports === 'string' ? manifest.exports : manifest.exports?.['.']?.default;
      check(typeof exported === 'string' && exported.startsWith('./'), `${entry.id}: package must export a local default entry.`);
      localFile(directory, entry.source.path + '/' + exported.slice(2));
    } else {
      fields(entry.source, ['type', 'repository', 'commit', 'path', 'manifest'], `${entry.id}.source`);
      check(entry.source.type === 'github', `${entry.id}: source.type must be builtin or github.`);
      check(typeof entry.source.repository === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.source.repository), `${entry.id}: use a canonical https://github.com/owner/repository URL.`);
      check(typeof entry.source.commit === 'string' && /^[a-f0-9]{40}$/.test(entry.source.commit), `${entry.id}: pin a full lowercase 40-character commit SHA, never a branch or tag.`);
      safePath(entry.source.path, `${entry.id}.source.path`);
      safePath(entry.source.manifest, `${entry.id}.source.manifest`);
      check(entry.source.manifest.endsWith('.json'), `${entry.id}: source.manifest must point to a JSON plugin manifest.`);
    }
    entries.push({...entry, ...Object.fromEntries(Object.keys(relations).map(field => [field, sorted(entry[field])])), dependencies, peerDependencies, ...(version ? {version} : {}), dependents: {requiredBy: [], optionalFor: [], extendedBy: []}});
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const visiting = new Set(), ready = new Set();
  function visit(id) {
    check(byId.has(id), `Missing dependency entry: ${id}.`);
    check(!visiting.has(id), `Cyclic plugin dependency: ${id}.`);
    if (ready.has(id)) return;
    visiting.add(id);
    for (const field of Object.keys(relations)) for (const dependency of byId.get(id)[field]) visit(dependency);
    visiting.delete(id); ready.add(id);
  }
  for (const id of byId.keys()) visit(id);
  for (const entry of entries) for (const [field, reverse] of Object.entries(relations)) for (const dependency of entry[field]) byId.get(dependency).dependents[reverse].push(entry.id);
  for (const entry of entries) for (const field of Object.values(relations)) entry.dependents[field].sort();
  return {schemaVersion: 1, apiVersion: 1, plugins: entries};
}

const cell = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/([\\`*_[\]])/g, '\\$1');
const link = value => value.replace(/\(/g, '%28').replace(/\)/g, '%29');
export function renderCatalog(catalog) {
  const relationLabels = {requires: '必需', optionalRequires: '可选', extends: '继承'};
  const reverseLabels = {requiredBy: '必需依赖者', optionalFor: '可选联动者', extendedBy: '继承者'};
  const describe = (values, labels) => Object.entries(labels).filter(([field]) => values[field].length).map(([field, label]) => `${label}：${values[field].join(', ')}`).join('<br>') || '无';
  const rows = catalog.plugins.map(entry => {
    const source = entry.source.type === 'builtin' ? `../${entry.source.path}` : `${entry.source.repository}/blob/${entry.source.commit}/${entry.source.path}`;
    const manifest = entry.source.type === 'builtin' ? `../${entry.source.path}/plugin.json` : `${entry.source.repository}/blob/${entry.source.commit}/${entry.source.manifest}`;
    return `| [${entry.id}](${link(source)}) / [清单](${link(manifest)}) | ${cell(entry.name)}：${cell(entry.summary)} | ${entry.category} | ${describe(entry, relationLabels)} | ${describe(entry.dependents, reverseLabels)} | ${cell(entry.license)} | ${entry.authors.map(author => `[${cell(author.name)}](${link(author.url)})`).join(', ')} |`;
  });
  const node = id => 'p_' + id.replaceAll('-', '_');
  const graph = catalog.plugins.flatMap(entry => [`  ${node(entry.id)}["${entry.id}"]`, ...Object.entries(relations).flatMap(([field]) => entry[field].map(id => `  ${node(entry.id)} ${field === 'optionalRequires' ? '-.' : '--'} ${relationLabels[field]} ${field === 'optionalRequires' ? '.->' : '-->'} ${node(id)}`))]);
  return '# Agent Blog 插件广场\n\n' +
    '每个功能独立安装、配置和禁用。欢迎通过 Pull Request 分享插件；提交方式、元数据约定及审核范围见[参与指南](../docs/marketplace.md)。\n\n' +
    '本目录由 `marketplace/entries/*.json` 与各包的 `plugin.json` 核对后生成。提交条目后运行 `node scripts/check-marketplace.mjs`；使用 `--check` 核对生成结果。条目是描述数据，收录不代表安全审计。插件启用后属于受信任的本地代码，拥有当前进程权限。\n\n' +
    '所有条目兼容插件 API v1。必需依赖和继承的基础插件必须启用；可选联动在对方缺席时仍可运行。继承通过基础插件的公开服务与组件回退组合实现。完整 npm 依赖和来源固定版本见[机器可读目录](../packages/marketplace/catalog.json)或每个[原始条目](entries/)。\n\n' +
    '| 插件 / 源码 | 名称与用途 | 分类 | 依赖与继承 | 直接影响范围 | 许可证 | 作者 |\n| --- | --- | --- | --- | --- | --- | --- |\n' + rows.join('\n') + '\n\n' +
    '## 关系图\n\n箭头从使用者指向其依赖或基础插件；虚线表示可选联动。更新插件时，从表中的直接影响范围继续检查下游；图和反向列表均自动生成。\n\n```mermaid\nflowchart LR\n' + graph.join('\n') + '\n```\n\n' +
    '离线查询：启用 `@agent-blog/marketplace` 后运行 `agent-blog marketplace-list --json` 或 `agent-blog marketplace-get notes --json`。目录插件不下载、不安装、不执行目录中的插件。\n';
}

export function updateCatalog(directory = root, {checkOnly = false} = {}) {
  const catalog = readCatalog(directory);
  const outputs = {'marketplace/README.md': renderCatalog(catalog), 'packages/marketplace/catalog.json': json(catalog)};
  for (const [relative, content] of Object.entries(outputs)) {
    const filename = path.join(directory, relative);
    if (checkOnly) check(fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === content, `Stale generated catalog: ${relative}. Run node scripts/check-marketplace.mjs.`);
    else { fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, content); }
  }
  return {plugins: catalog.plugins.length, checked: checkOnly};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.slice(2).every(argument => argument === '--check'), 'Usage: node scripts/check-marketplace.mjs [--check]');
    console.log(JSON.stringify({ok: true, ...updateCatalog(root, {checkOnly: process.argv.includes('--check')})}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
