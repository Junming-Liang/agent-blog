import {fail} from './content.mjs';

export function notifications() {
  const listeners = new Map(), queue = [];
  let flushing;
  return {
    on(name, handler) {
      if (!['post:written', 'post:removed', 'build:completed', 'command:completed'].includes(name) || typeof handler !== 'function') fail('INVALID_EVENT', 'Use a documented lifecycle event and a handler.');
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    emit(name, value) { if (listeners.has(name)) queue.push({name, value: structuredClone(value)}); },
    flush() {
      if (flushing) return flushing;
      flushing = (async () => {
        const warnings = [];
        while (queue.length) {
          const {name, value} = queue.shift();
          for (const handler of listeners.get(name) || []) {
            try { await handler(structuredClone(value)); }
            catch (error) { warnings.push({code: 'HOOK_FAILED', event: name, message: String(error?.message || error)}); }
          }
        }
        return warnings;
      })().finally(() => { flushing = undefined; });
      return flushing;
    }
  };
}

export function validateInvocation(definition, invocation) {
  if (invocation !== undefined && (!invocation || typeof invocation !== 'object' || Array.isArray(invocation))) fail('INVALID_INPUT', 'Pass an invocation object.');
  const {args = [], flags = {}, input} = invocation || {};
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string') || args.length !== (definition.arguments?.length || 0)) fail('INVALID_ARGUMENT', `Expected arguments: ${(definition.arguments || []).join(' ')}.`);
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) fail('INVALID_OPTION', 'flags must be an object.');
  for (const [key, value] of Object.entries(flags)) {
    const field = definition.flags?.[key];
    if (!field || typeof value !== field.type || (field.type === 'number' && !Number.isFinite(value)) || (field.enum && !field.enum.includes(value))) fail('INVALID_OPTION', `Invalid --${key} value.`);
  }
  for (const [key, field] of Object.entries(definition.flags || {})) if (field.required && !Object.hasOwn(flags, key)) fail('INVALID_OPTION', `Required option: --${key}.`);
  if (input !== undefined && (!definition.stdin || (definition.stdin === 'text' && typeof input !== 'string'))) fail('INVALID_INPUT', 'This command does not accept that input.');
  return {args: [...args], flags: {...flags}, input};
}

export async function chain(handlers, context, run) {
  async function next(index) {
    if (index === handlers.length) return run();
    let used = false;
    return handlers[index](context, () => {
      if (used) fail('NEXT_REUSED', 'Middleware may call next only once.');
      used = true;
      return next(index + 1);
    });
  }
  return next(0);
}

export function pagePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || !url.endsWith('/') || /[?#\\]/.test(url)) fail('INVALID_PERMALINK', 'Return a local absolute directory URL with a trailing slash.');
  let parts;
  try { parts = url.slice(1, -1).split('/').map(decodeURIComponent); }
  catch { fail('INVALID_PERMALINK', 'Invalid URL encoding.'); }
  if (parts.some(part => !part || part.startsWith('.') || /[\/\\\x00-\x1f?#]/.test(part)) || parts[0] === '_assets') fail('INVALID_PERMALINK', 'Use safe, nonempty path segments outside /_assets/.');
  return parts.join('/') + '/index.html';
}

export function pageFiles(blog, published) {
  const files = new Map();
  for (const post of published) {
    const relative = pagePath(blog.permalink(post));
    if ([...files.keys()].some(name => name === relative || name.startsWith(relative + '/') || relative.startsWith(name + '/')) || [...blog.outputs.keys()].some(name => name === relative || name.startsWith(relative + '/') || relative.startsWith(name + '/'))) fail('OUTPUT_COLLISION', `Conflicting post output: ${relative}`);
    files.set(relative, post);
  }
  return files;
}
