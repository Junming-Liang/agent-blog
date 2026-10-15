import {fileURLToPath} from 'node:url';

/** @type {import('@agent-blog/core').Plugin} */
export default {
  name: 'theme-paper', apiVersion: 1,
  description: 'Warm paper typography and a quiet reading layout.',
  setup(api) {
    api.layout(context => context.render('shell'), {unstyled: true});
    api.asset('/_assets/theme-paper', fileURLToPath(new URL('./public', import.meta.url)));
    api.stylesheet('/_assets/theme-paper/style.css');
  }
};
