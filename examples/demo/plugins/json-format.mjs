/** @type {import('@agent-blog/core').Plugin} */
export default {
  name: 'json-format', apiVersion: 1,
  description: 'Store each article as a JSON file instead of Markdown front matter.',
  setup(api) {
    api.codec({extension: '.json', decode: (_slug, source) => JSON.parse(source), encode: post => JSON.stringify(post, null, 2) + '\n'});
  }
};
