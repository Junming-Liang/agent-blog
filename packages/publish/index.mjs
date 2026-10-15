import manifest from './plugin.json' with {type: 'json'};
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {loadSite, build} from '@agent-blog/core';

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Rebuild the public site after a content change; keep the editing service private.',
  optionsSchema: {type: 'object', properties: {}, additionalProperties: false},
  setup(api, options) {
    if (Object.keys(options).length) api.fail('INVALID_OPTION', 'publish-on-save does not accept options.');
    async function publish() {
      const lock = path.join(api.site.root, '.publish-lock');
      const deadline = Date.now() + 25000;
      for (;;) {
        try { await fs.mkdir(lock, {mode: 0o700}); break; }
        catch (error) {
          if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
          await setTimeout(100);
        }
      }
      try {
        await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid, at: new Date().toISOString()}));
        // Read the latest files after taking the lock, including changes made by a CLI process.
        await build(await loadSite(api.site.root));
      } finally { await fs.rm(lock, {recursive: true, force: true}); }
    }
    api.on('post:written', publish);
    api.on('post:removed', publish);
  }
};
