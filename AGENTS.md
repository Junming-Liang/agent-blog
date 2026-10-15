# Agent Blog development

This is a standalone Node.js project.
Run its build and tests directly with the available Node.js 22+ runtime.

- Keep `packages/core` free of runtime dependencies and provider-specific APIs.
- Default to readable Markdown with JSON front matter. A storage or codec plugin may replace that default; honor its published contract.
- Register adapters before first content access. Raw storage adapters must perform atomic revision comparisons.
- Keep lifecycle failures separate from already-committed content; inspect flushEvents warnings.
- Put optional behavior in plugins. Do not add a plugin's dependency to core.
- Use `schema --json` to discover CLI commands; preserve JSON output contracts.
- Read a post's revision before modifying it. Never bypass a revision conflict.
- Plugins are trusted local code, with the authority of the user running the CLI.
- Keep the editing server loopback-only. Build output contains published posts only.
- Run `npm run build:editor` and `npm test` after relevant changes.
- Deploy generated sites or change public routing only with explicit user authorization.
