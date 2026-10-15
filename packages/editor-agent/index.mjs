import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';

export default {
  ...manifest,
  description: 'Share the current editor draft and revision with a coding agent.',
  setup(api) {
    api.asset('/_assets/editor-agent', fileURLToPath(new URL('./public', import.meta.url)), {public: false});
    api.require('editor').register({name: 'editor-agent', module: '/_assets/editor-agent/browser.mjs'});
  }
};
