import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';
import MarkdownIt from 'markdown-it';
export default {
  ...manifest,

  description: 'Render CommonMark and GitHub-style tables with markdown-it.',
  optionsSchema: {type: 'object', properties: {html: {type: 'boolean', default: false}, linkify: {type: 'boolean', default: true}, breaks: {type: 'boolean'}, typographer: {type: 'boolean'}}},
  setup(api, options) {
    const editor = api.optional('editor');
    if (editor) {
      api.asset('/_assets/markdown-editor', fileURLToPath(new URL('./editor', import.meta.url)), {public: false});
      editor.register({name: 'markdown', module: '/_assets/markdown-editor/browser.mjs'});
    }
    const markdown = new MarkdownIt({html: false, linkify: true, ...options});
    api.provide('markdown', markdown);
    api.renderer((body, context) => markdown.render(body, context));
  }
};
