import MarkdownIt from 'markdown-it';
export default {
  name: 'markdown',
  apiVersion: 1,
  description: 'Render CommonMark and GitHub-style tables with markdown-it.',
  optionsSchema: {type: 'object', properties: {html: {type: 'boolean', default: false}, linkify: {type: 'boolean', default: true}, breaks: {type: 'boolean'}, typographer: {type: 'boolean'}}},
  setup(api, options) {
    const markdown = new MarkdownIt({html: false, linkify: true, ...options});
    api.provide('markdown', markdown);
    api.renderer((body, context) => markdown.render(body, context));
  }
};
