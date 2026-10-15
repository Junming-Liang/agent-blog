# Agent Blog core

Zero-runtime-dependency file-based blog core for humans and coding agents.

The package provides the CLI, post storage with optimistic revision checks,
plugin API v1, static builds, and loopback previews. Storage, codecs, renderers,
themes, page components, editor tools, and build pipelines have public plugin
interfaces. See `api.d.ts` for the complete public contract.

Run `agent-blog --help --json` to discover core commands before initializing a
site. Run `agent-blog schema --site ./my-blog --json` to discover enabled plugin
commands. CLI output uses `{ok:true,data}` or `{ok:false,error:{code,message}}`.

The default stores posts as `content/slug.md` with JSON front matter between
`---` lines. Codec and synchronous storage plugins can replace that default.
New posts are drafts. Read their current revision before writing or deleting.
The core itself calls no model provider and starts no public editing service.
