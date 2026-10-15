import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export class BlogError extends Error {
  constructor(code, message, status = 400) { super(message); Object.assign(this, {code, status}); }
}
export const fail = (code, message, status) => { throw new BlogError(code, message, status); };
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const revision = source => createHash('sha256').update(source).digest('hex');
export const postInputSchema = {
  type: 'object', required: ['metadata', 'body'],
  properties: {
    body: {type: 'string'},
    metadata: {type: 'object', required: ['title', 'draft'], properties: {
      title: {type: 'string', minLength: 1}, draft: {type: 'boolean'}, date: {type: 'string'},
      tags: {type: 'array', items: {type: 'string'}}, description: {type: 'string'}
    }, additionalProperties: true}
  }
};
export function withWriteLock(root, operation) {
  const lock = path.join(root, '.write-lock');
  try { fs.mkdirSync(lock, {mode: 0o700}); } catch (error) {
    if (error.code === 'EEXIST') fail('BUSY', 'Another write owns .write-lock. Retry; inspect owner.json after a crashed process.', 409);
    throw error;
  }
  try { fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid, at: new Date().toISOString()})); return operation(); }
  finally { fs.rmSync(lock, {recursive: true}); }
}
export function slugCheck(slug) {
  if (typeof slug !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(slug)) fail('INVALID_SLUG', 'Slug must contain letters, numbers, hyphens or underscores.');
  return slug;
}
function regular(file) {
  if (!fs.lstatSync(file).isFile()) fail('UNSAFE_FILE', `Not a regular file: ${file}`);
}
export function validatePost(value) {
  if (!value || typeof value.body !== 'string' || !value.metadata || Array.isArray(value.metadata) || typeof value.metadata !== 'object') fail('INVALID_POST', 'Expected {metadata: {...}, body: string}.');
  const m = value.metadata;
  if (typeof m.title !== 'string' || !m.title.trim()) fail('INVALID_POST', 'A nonempty title is required.');
  if (typeof m.draft !== 'boolean') fail('INVALID_POST', 'draft must be a boolean.');
  if (m.date !== undefined && (typeof m.date !== 'string' || !Number.isFinite(Date.parse(m.date)))) fail('INVALID_POST', 'date must be a valid date string.');
  if (m.tags !== undefined && (!Array.isArray(m.tags) || m.tags.some(tag => typeof tag !== 'string'))) fail('INVALID_POST', 'tags must be an array of strings.');
  if (m.description !== undefined && typeof m.description !== 'string') fail('INVALID_POST', 'description must be a string.');
  return value;
}
export function decodePost(slug, source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  let metadata = {title: slug, draft: true};
  if (match) {
    try { metadata = JSON.parse(match[1]); } catch { fail('INVALID_FRONTMATTER', `${slug}: front matter must be a JSON object.`); }
  }
  const body = match ? source.slice(match[0].length) : source;
  validatePost({metadata, body});
  return {slug, metadata, body, revision: revision(source)};
}
export const jsonMarkdown = {
  extension: '.md',
  decode(slug, source) { const {metadata, body} = decodePost(slug, source); return {metadata, body}; },
  encode(value) { return `---\n${JSON.stringify(value.metadata, null, 2)}\n---\n${value.body}`; }
};
export function fileStorage(root, extension = '.md') {
  const directory = path.join(root, 'content');
  if (!fs.lstatSync(directory).isDirectory()) fail('UNSAFE_CONTENT', 'content must be a real directory.');
  const fileFor = slug => path.join(directory, slugCheck(slug) + extension);
  const read = slug => {
    const file = fileFor(slug);
    if (!fs.existsSync(file)) return null;
    regular(file);
    return fs.readFileSync(file, 'utf8');
  };
  // Adapters own atomic revision comparison; the file adapter serializes framework writers.
  const compare = (slug, expectedRevision) => {
    const source = read(slug);
    if ((source === null ? null : revision(source)) !== expectedRevision) fail('CONFLICT', 'The post changed. Read it again and merge your edits.', 409);
  };
  return {
    read,
    list: () => fs.readdirSync(directory).filter(name => name.endsWith(extension)).map(name => name.slice(0, -extension.length)),
    write(slug, source, expectedRevision) {
      return withWriteLock(root, () => {
        compare(slug, expectedRevision);
        const temporary = path.join(directory, `.${slug}.${randomUUID()}.tmp`);
        try { fs.writeFileSync(temporary, source, {flag: 'wx', mode: 0o600}); fs.renameSync(temporary, fileFor(slug)); }
        finally { fs.rmSync(temporary, {force: true}); }
      });
    },
    remove(slug, expectedRevision) {
      return withWriteLock(root, () => { compare(slug, expectedRevision); fs.unlinkSync(fileFor(slug)); });
    }
  };
}
function synchronous(value, code) {
  if (value && typeof value.then === 'function') {
    Promise.resolve(value).catch(() => {});
    fail(code, 'This contract requires a synchronous implementation.');
  }
  return value;
}
export function contentStore(root, {codec = jsonMarkdown, storage = fileStorage(root, codec.extension), validators = [], emit = () => {}} = {}) {
  const validate = value => {
    validatePost(value);
    for (const validator of validators) {
      synchronous(validator(structuredClone(value)), 'ASYNC_VALIDATOR');
    }
    return value;
  };
  const sourceFor = slug => {
    slugCheck(slug);
    const source = synchronous(storage.read(slug), 'INVALID_STORAGE');
    if (source !== null && typeof source !== 'string') fail('INVALID_STORAGE', 'Storage read must return a string or null.');
    return source;
  };
  const read = slug => {
    const source = sourceFor(slug);
    if (source === null) fail('NOT_FOUND', `Post not found: ${slug}`, 404);
    const value = validate(synchronous(codec.decode(slug, source), 'INVALID_CODEC'));
    return {slug, metadata: value.metadata, body: value.body, revision: revision(source)};
  };
  const list = () => {
    const slugs = synchronous(storage.list(), 'INVALID_STORAGE');
    if (!Array.isArray(slugs) || slugs.some(slug => typeof slug !== 'string') || new Set(slugs).size !== slugs.length) fail('INVALID_STORAGE', 'Storage list must return unique slug strings.');
    return slugs.map(read).sort((a, b) => (b.metadata.date || '').localeCompare(a.metadata.date || '') || a.slug.localeCompare(b.slug));
  };
  const checkRevision = (slug, expected, creating = false) => {
    if (typeof expected !== 'string' && !(creating && expected === null)) fail('REVISION_REQUIRED', 'Read the current revision first; use null only when creating a new post.');
    const source = sourceFor(slug);
    if ((source === null ? null : revision(source)) !== expected) fail('CONFLICT', 'The post changed. Read it again and merge your edits.', 409);
  };
  return {
    read, list, validate,
    write(slug, value, expectedRevision) {
      validate(value); checkRevision(slug, expectedRevision, true);
      const source = synchronous(codec.encode(structuredClone(value)), 'INVALID_CODEC');
      if (typeof source !== 'string') fail('INVALID_CODEC', 'encode must return a source string.');
      validate(synchronous(codec.decode(slug, source), 'INVALID_CODEC'));
      synchronous(storage.write(slug, source, expectedRevision), 'INVALID_STORAGE');
      const post = read(slug);
      emit('post:written', {post, created: expectedRevision === null});
      return post;
    },
    remove(slug, expectedRevision) {
      checkRevision(slug, expectedRevision);
      const post = read(slug);
      synchronous(storage.remove(slug, expectedRevision), 'INVALID_STORAGE');
      emit('post:removed', {post});
      return {slug, removed: true};
    }
  };
}
