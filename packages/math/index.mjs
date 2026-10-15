import path from 'node:path';
import {createRequire} from 'node:module';
import katex from 'katex';
const require = createRequire(import.meta.url);
export default {
  name: 'math',
  apiVersion: 1,
  requires: ['markdown'],
  description: 'Render inline and display TeX to static HTML and MathML.',
  optionsSchema: {type: 'object', description: 'KaTeX options; trust, error handling, macro state and expansion limits are controlled by this plugin.', properties: {fleqn: {type: 'boolean'}, leqno: {type: 'boolean'}, errorColor: {type: 'string'}}},
  setup(api, options) {
    const markdown = api.require('markdown');
    const render = (source, displayMode) => katex.renderToString(source, {...options, displayMode, trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20, macros: {}});
    markdown.inline.ruler.before('escape', 'agent_math', (state, silent) => {
      const start = state.pos;
      if (state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || '')) return false;
      let end = start + 1;
      for (; end < state.posMax; end++) {
        if (state.src[end] === '\\') { end++; continue; }
        if (state.src[end] === '$') break;
      }
      if (end >= state.posMax || end === start + 1 || /\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] || '')) return false;
      if (!silent) { const token = state.push('agent_math_inline', 'math', 0); token.content = state.src.slice(start + 1, end); }
      state.pos = end + 1;
      return true;
    });
    markdown.block.ruler.before('fence', 'agent_math_block', (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const first = state.bMarks[startLine] + state.tShift[startLine];
      const opening = state.src.slice(first, state.eMarks[startLine]);
      if (!opening.startsWith('$$')) return false;
      let source = opening.slice(2), closingLine = startLine;
      const sameLine = source.indexOf('$$');
      if (sameLine >= 0) {
        if (source.slice(sameLine + 2).trim()) return false;
        source = source.slice(0, sameLine);
      } else {
        let found = false;
        for (closingLine = startLine + 1; closingLine < endLine; closingLine++) {
          const line = state.src.slice(state.bMarks[closingLine] + state.tShift[closingLine], state.eMarks[closingLine]);
          const end = line.indexOf('$$');
          if (end >= 0 && !line.slice(end + 2).trim()) { source += '\n' + line.slice(0, end); found = true; break; }
          source += '\n' + line;
        }
        if (!found) return false;
      }
      if (silent) return true;
      const token = state.push('agent_math_block', 'math', 0);
      token.block = true; token.content = source.trim(); token.map = [startLine, closingLine + 1]; state.line = closingLine + 1;
      return true;
    }, {alt: ['paragraph', 'reference', 'blockquote', 'list']});
    markdown.renderer.rules.agent_math_inline = (tokens, index) => render(tokens[index].content, false);
    markdown.renderer.rules.agent_math_block = (tokens, index) => render(tokens[index].content, true) + '\n';
    const dist = path.dirname(require.resolve('katex/dist/katex.min.css'));
    api.asset('/_assets/math', dist, {include: ['katex.min.css', 'fonts']});
    api.stylesheet('/_assets/math/katex.min.css');
  }
};
