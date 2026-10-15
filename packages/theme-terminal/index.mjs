import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Dark terminal typography with green accents.',
  setup(api) {
    api.layout(context => context.render('shell'), {unstyled: true});
    api.asset('/_assets/theme-terminal', fileURLToPath(new URL('./public', import.meta.url)));
    api.stylesheet('/_assets/theme-terminal/style.css');
  }
};
