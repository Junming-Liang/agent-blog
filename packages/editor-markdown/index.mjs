import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';
export default {
  ...manifest,
  description: 'Optional Markdown and fenced-code language support in the editor.',
  setup(api) {
    api.asset('/_assets/editor-markdown', fileURLToPath(new URL('./public', import.meta.url)), {public: false});
    api.require('editor').register({name: 'editor-markdown', module: '/_assets/editor-markdown/bundle/browser.js'});
  }
};
