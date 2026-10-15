import {fileURLToPath} from 'node:url';

const statistics = body => ({characters: [...body.replace(/\s/g, '')].length, lines: body.split('\n').length});
/** @type {import('@agent-blog/core').Plugin} */
export default {
  name: 'writing-tools', apiVersion: 1, requires: ['editor'],
  description: 'Extend the editor toolbar and panel; share a statistics command with agents.',
  setup(api) {
    api.command({name: 'writing-stats', description: 'Count characters and lines in a saved or unsaved article.', stdin: 'json', run({input}) { return statistics(api.posts.validate(input).body); }});
    api.asset('/_assets/writing-tools', fileURLToPath(new URL('./writing-tools', import.meta.url)), {public: false});
    /** @type {import('@agent-blog/editor').EditorService} */
    const editor = api.require('editor');
    editor.register({name: 'writing-tools', module: '/_assets/writing-tools/browser.mjs'});
    api.slot('post:after', ({post}) => `<p class="writing-statistics">正文 ${statistics(post.body).characters} 字符</p>`);
  }
};
