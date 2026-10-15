/** @type {import('@agent-blog/core').Plugin} */
export default {
  name: 'reading-time', apiVersion: 1,
  description: 'An example agent-authored plugin using only the public API.',
  optionsSchema: {type: 'object', properties: {speed: {type: 'number', exclusiveMinimum: 0, default: 240}}},
  setup(api, options) {
    api.command({
      name: 'reading-time',
      description: 'Estimate reading time for one article, with an optional reading speed.',
      arguments: ['slug'],
      flags: {speed: {type: 'number', description: 'Words per minute; defaults to post metadata or 240'}},
      run({args, flags}) {
        const post = api.posts.read(args[0]);
        const speed = flags.speed ?? post.metadata.readingSpeed ?? options.speed ?? 240;
        if (!Number.isFinite(speed) || speed <= 0) api.fail('INVALID_SPEED', 'Reading speed must be positive.');
        const words = [...new Intl.Segmenter('zh', {granularity: 'word'}).segment(post.body)].filter(segment => segment.isWordLike).length;
        return {slug: post.slug, words, minutes: Math.max(1, Math.ceil(words / speed))};
      }
    });
  }
};
