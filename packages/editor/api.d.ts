import type {Plugin} from '@agent-blog/core';
export interface EditorRegistration {name: string; module?: string; stylesheet?: string; options?: Record<string, unknown>}
export interface EditorService {register(extension: EditorRegistration): void}
declare const plugin: Plugin;
export default plugin;
