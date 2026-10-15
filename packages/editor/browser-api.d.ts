import type {Metadata, PostInput, Invocation} from '@agent-blog/core';
import type {EditorView} from '@codemirror/view';
import type {Extension} from '@codemirror/state';
export interface EditorDraft extends PostInput {slug: string; revision: string | null}
export type EditorSlot = 'toolbar' | 'sidebar' | 'panels' | 'topbar';
export interface EditorAPI {
  readonly editor: EditorView;
  readonly codemirror: {
    EditorState: typeof import('@codemirror/state').EditorState;
    StateEffect: typeof import('@codemirror/state').StateEffect;
    EditorView: typeof import('@codemirror/view').EditorView;
    keymap: typeof import('@codemirror/view').keymap;
    syntaxHighlighting: typeof import('@codemirror/language').syntaxHighlighting;
  };
  getDraft(): EditorDraft | null;
  updateDraft(patch: {metadata?: Partial<Metadata>; body?: string}): void;
  insert(before: string, after?: string): void;
  save(draft?: boolean): Promise<void>;
  status(message: string, error?: boolean): void;
  mount(location: EditorSlot, element: HTMLElement): () => void;
  button(options: {id: string; label: string; title?: string; location?: EditorSlot; run(): void | Promise<void>}): HTMLButtonElement;
  extension(value: Extension): void;
  on(event: 'open' | 'change' | 'saved', handler: (draft: EditorDraft | null) => void | Promise<void>): () => void;
  command(name: string, invocation?: Invocation): Promise<unknown>;
}
export interface EditorExtension {setup(api: EditorAPI, options: Record<string, unknown>): void | Promise<void>}
