import type {IncomingMessage, ServerResponse, Server} from 'node:http';

export interface Metadata {
  title: string;
  draft: boolean;
  date?: string;
  tags?: string[];
  description?: string;
  [key: string]: unknown;
}
export interface PostInput {metadata: Metadata; body: string}
export interface Post extends PostInput {slug: string; revision: string}
export interface ContentStore {
  validate(input: unknown): PostInput;
  read(slug: string): Post;
  list(): Post[];
  write(slug: string, input: PostInput, expectedRevision: string | null): Post;
  remove(slug: string, expectedRevision: string): {slug: string; removed: true};
}
/** Synchronous raw-source storage. write/remove MUST compare revisions atomically. */
export interface StorageAdapter {
  read(slug: string): string | null;
  list(): string[];
  write(slug: string, source: string, expectedRevision: string | null): void;
  remove(slug: string, expectedRevision: string): void;
}
export interface ContentCodec {
  extension: string;
  decode(slug: string, source: string): PostInput;
  encode(input: PostInput): string;
}
export interface Invocation {args?: string[]; flags?: Record<string, string | boolean | number>; input?: unknown}
export interface CommandContext {name: string; args: string[]; flags: Record<string, string | boolean | number>; input?: unknown; site: Site}
export interface HookWarning {code: 'HOOK_FAILED'; event: string; message: string}
export interface BuildResult {output: string; posts: number; plugins: LoadedPlugin[]; warnings?: HookWarning[]}
export interface LifecycleEvents {
  'post:written': {post: Post; created: boolean};
  'post:removed': {post: Post};
  'build:completed': {result: BuildResult};
  'command:completed': {name: string; args: string[]};
}
export interface PluginEntry {use: string; enabled?: boolean; options?: Record<string, unknown>}
export interface Config {version: 1; title: string; description?: string; language?: string; plugins: (string | PluginEntry)[]}
export interface Site extends Config {root: string}
export interface Flag {type: 'string' | 'boolean' | 'number'; description?: string; required?: boolean; enum?: (string | number | boolean)[]}
export interface Command {
  name: string;
  description: string;
  arguments?: string[];
  flags?: Record<string, Flag>;
  stdin?: 'text' | 'json';
  /** Documentation for agent tools; command implementations validate their domain input. */
  inputSchema?: Record<string, unknown>;
  run(context: {args: string[]; flags: Record<string, string | boolean | number>; input?: unknown}): unknown | Promise<unknown>;
}
export interface RenderContext {post: Post; site: Site}
export interface PageContext {
  site: Site; post?: Post; html: string; posts: Post[]; styles: string[];
  permalink(post: Post): string;
  render(name: string, overrides?: Partial<PageContext>): Promise<string>;
  renderDefault(name: string, overrides?: Partial<PageContext>): Promise<string>;
  slot(name: string): Promise<string>;
}
export interface OutputContext {site: Site; posts: Post[]}
export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  pathname: string;
  blog: Blog;
  json(res: ServerResponse, status: number, value: unknown): void;
  html(res: ServerResponse, html: string): void;
  readJSON(req: IncomingMessage): Promise<unknown>;
}
export interface PluginAPI {
  readonly apiVersion: 1;
  readonly site: Site;
  readonly posts: ContentStore;
  escapeHTML(value: unknown): string;
  fail(code: string, message: string, status?: number): never;
  provide<T>(name: string, service: T): void;
  require<T>(name: string): T;
  renderer(render: (body: string, context: RenderContext) => string | Promise<string>): void;
  transform(transform: (context: RenderContext & {html: string}) => string | Promise<string>): void;
  layout(layout: (context: PageContext) => string | Promise<string>, options?: {unstyled?: boolean}): void;
  component(name: string, render: (context: PageContext) => string | Promise<string>): void;
  slot(name: string, render: (context: PageContext) => string | Promise<string>): void;
  storage(adapter: StorageAdapter): void;
  codec(adapter: ContentCodec): void;
  validator(validate: (input: PostInput) => void): void;
  permalink(link: (post: Post) => string): void;
  builder(build: (context: {blog: Blog; build(): Promise<BuildResult>}) => BuildResult | Promise<BuildResult>): void;
  middleware(handler: (context: RouteContext, next: () => Promise<void>) => void | Promise<void>): void;
  commandMiddleware(handler: (context: CommandContext, next: () => Promise<unknown>) => unknown | Promise<unknown>): void;
  on<K extends keyof LifecycleEvents>(event: K, handler: (value: LifecycleEvents[K]) => void | Promise<void>): void;
  execute(name: string, invocation?: Invocation): Promise<unknown>;
  command(command: Command): void;
  route(prefix: string, handler: (context: RouteContext) => void | Promise<void>): void;
  output(relativePath: string, render: string | ((context: OutputContext) => string | Promise<string>)): void;
  asset(prefix: string, directory: string, options?: {public?: boolean; include?: string[]}): void;
  stylesheet(url: string): void;
}
export interface Plugin {
  name: string;
  apiVersion: 1;
  description?: string;
  requires?: string[];
  /** Machine-readable configuration description; setup validates domain options. */
  optionsSchema?: Record<string, unknown>;
  setup(api: PluginAPI, options: Record<string, unknown>): void | Promise<void>;
}
export interface LoadedPlugin {name: string; apiVersion: number; description: string; requires: string[]; use: string; optionsSchema?: Record<string, unknown>}
export interface Blog {
  site: Site;
  posts: ContentStore;
  plugins: LoadedPlugin[];
  commands: Map<string, Command>;
  routes: {prefix: string; handler: (context: RouteContext) => void | Promise<void>}[];
  outputs: Map<string, (context: OutputContext) => string | Promise<string>>;
  middleware: ((context: RouteContext, next: () => Promise<void>) => void | Promise<void>)[];
  builder?: (context: {blog: Blog; build(): Promise<BuildResult>}) => BuildResult | Promise<BuildResult>;
  permalink(post: Post): string;
  execute(name: string, invocation?: Invocation): Promise<unknown>;
  invoke(command: Command, invocation?: Invocation): Promise<unknown>;
  flushEvents(): Promise<HookWarning[]>;
  assets: {prefix: string; directory: string; public: boolean; include?: string[]}[];
  renderPost(post: Post): Promise<string>;
  renderOutput(name: string, published?: Post[]): Promise<string>;
  page(post?: Post, published?: Post[]): Promise<string>;
}
export function loadSite(directory: string, options?: {config?: Config}): Promise<Blog>;
export function readSiteConfig(directory: string): {root: string; config: Config};
export function build(blog: Blog): Promise<BuildResult>;
export function serve(blog: Blog, options?: {port?: number}): Promise<Server>;
export function escapeHTML(value: unknown): string;
export class BlogError extends Error {code: string; status: number; constructor(code: string, message: string, status?: number)}
