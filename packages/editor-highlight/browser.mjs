import {syntaxHighlighting, defaultHighlightStyle} from '@codemirror/language';

export function setup(api) {
  api.extension(syntaxHighlighting(defaultHighlightStyle));
}
