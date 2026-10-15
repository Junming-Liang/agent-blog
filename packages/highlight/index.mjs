import {fileURLToPath} from 'node:url';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import cpp from 'highlight.js/lib/languages/cpp';
const languages = {javascript, python, bash, json, css, xml, cpp};
export default {
  name: 'highlight',
  apiVersion: 1,
  requires: ['markdown'],
  description: 'Highlight fenced code during rendering; no browser JavaScript.',
  optionsSchema: {type: 'object', properties: {languages: {type: 'array', items: {type: 'string', enum: Object.keys(languages)}}}},
  setup(api, options) {
    const markdown = api.require('markdown');
    const highlighter = hljs.newInstance();
    for (const language of options.languages || Object.keys(languages)) {
      if (!languages[language]) throw Error(`Unsupported bundled language: ${language}. Register additional grammars in a custom plugin.`);
      highlighter.registerLanguage(language, languages[language]);
    }
    api.provide('highlight', highlighter);
    markdown.options.highlight = (source, language) => highlighter.getLanguage(language) ? highlighter.highlight(source, {language}).value : markdown.utils.escapeHtml(source);
    api.asset('/_assets/highlight', fileURLToPath(new URL('./public', import.meta.url)));
    api.stylesheet('/_assets/highlight/highlight.css');
  }
};
