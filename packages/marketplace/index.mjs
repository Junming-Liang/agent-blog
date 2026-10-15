import manifest from './plugin.json' with {type: 'json'};
import fs from 'node:fs';

export default {
  ...manifest,

  description: 'Discover curated plugin metadata offline without installing or executing entries.',
  setup(api) {
    const catalog = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
    api.command({
      name: 'marketplace-list',
      description: 'List curated plugin metadata. Does not download, install or execute plugins.',
      flags: {query: {type: 'string', description: 'Search id, name and summary'}, category: {type: 'string', description: 'Filter by category'}},
      run({flags}) {
        const query = (flags.query || '').toLowerCase();
        const plugins = catalog.plugins.filter(entry => (!flags.category || entry.category === flags.category) && `${entry.id} ${entry.name} ${entry.summary}`.toLowerCase().includes(query));
        return {schemaVersion: catalog.schemaVersion, apiVersion: catalog.apiVersion, plugins: structuredClone(plugins)};
      }
    });
    api.command({
      name: 'marketplace-get',
      description: 'Read a plugin source revision, dependencies and author before reviewing and enabling it.',
      arguments: ['id'],
      run({args}) {
        const entry = catalog.plugins.find(entry => entry.id === args[0]);
        if (!entry) api.fail('NOT_FOUND', `No marketplace entry: ${args[0]}`);
        return structuredClone(entry);
      }
    });
  }
};
