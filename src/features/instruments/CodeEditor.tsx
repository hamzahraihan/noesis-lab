/**
 * Monaco, behind a lazy boundary.
 *
 * This is the only module that touches `monaco-editor`, so it is the only one
 * that costs its download: the firmware pane and the library slots reach it
 * through `lazy()` and show a placeholder until the chunk lands, which is what
 * keeps 2.7 MB off every route's first paint. The strings the editor has to be
 * told -- language ids, theme name -- live in `editor-constants` so callers can
 * render without this module.
 *
 * `monaco-setup` is imported for its side effects alone: it points Monaco's
 * language services at Vite's workers, registers the two languages and defines
 * the bench theme, all of which must have happened before an editor mounts.
 */

import Editor, { type EditorProps } from '@monaco-editor/react';
import './monaco-setup';

export default function CodeEditor(props: EditorProps) {
  return <Editor {...props} />;
}
