# Agent Blog development

This is a standalone Node.js project.
Run its build and tests directly with the available Node.js 22+ runtime.

- Keep `packages/core` free of runtime dependencies and provider-specific APIs.
- Default to readable Markdown with JSON front matter. A storage or codec plugin may replace that default; honor its published contract.
- Register adapters before first content access. Raw storage adapters must perform atomic revision comparisons.
- Keep lifecycle failures separate from already-committed content; inspect flushEvents warnings.
- Every new user-facing feature must live in its own independently enabled plugin. Core changes are limited to reusable hosting contracts.
- One plugin owns one feature, including that feature's CLI, browser tools, data fields, and rendering. Do not bundle unrelated site features in a site plugin.
- Declare required and optional cross-plugin dependencies; use public services. Never import another plugin's implementation or mutate its registration.
- Use additive slots and namespaced fallback components. Skins may override presentation, but must not own content type or publishing behavior.
- Disabling a plugin must preserve source content and unrelated features. Add a focused enable/disable/composition check for new features.
- Keep plugin dependencies in the plugin package. Plugin code is trusted in-process code, not a security sandbox.
- Add shared plugins to the reviewed marketplace catalog; never auto-install or execute community submissions during catalog checks.
- Use `schema --json` to discover CLI commands; preserve JSON output contracts.
- Read a post's revision before modifying it. Never bypass a revision conflict.
- Plugins are trusted local code, with the authority of the user running the CLI.
- Keep the editing server loopback-only. Build output contains published posts only.
- Run `npm run build:editor` and `npm test` after relevant changes.
- Deploy generated sites or change public routing only with explicit user authorization.
