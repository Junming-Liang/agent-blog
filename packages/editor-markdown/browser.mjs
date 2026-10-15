import {markdown} from '@codemirror/lang-markdown';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {LanguageDescription} from '@codemirror/language';

export function setup(api) {
  api.extension(markdown({codeLanguages: [
    LanguageDescription.of({name: 'JavaScript', alias: ['js', 'javascript'], support: javascript()}),
    LanguageDescription.of({name: 'Python', alias: ['py', 'python'], support: python()})
  ]}));
}
