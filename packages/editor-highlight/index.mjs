import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';
export default {
  ...manifest,
  description: 'Optional syntax colors in the editor.',
  setup(api) {
    api.asset('/_assets/editor-highlight', fileURLToPath(new URL('./public', import.meta.url)), {public: false});
    api.require('editor').register({name: 'editor-highlight', module: '/_assets/editor-highlight/bundle/browser.js'});
  }
};
