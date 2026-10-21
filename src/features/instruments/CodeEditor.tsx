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
 *
 * The margin a stop is set on lives here too, for the same reason: the
 * glyph-margin click is a Monaco event, and the module that knows how to
 * listen for it is the one that already loads Monaco.
 */

import { useEffect, useRef } from 'react';
import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import './monaco-setup';

export interface CodeEditorProps extends EditorProps {
  /** The lines of this file that carry a stop. */
  stops?: readonly number[];
  /** Called with the line of a stop the person set or took off. */
  onToggleStop?: (line: number) => void;
  /**
   * The line the program is stopped on, if this file is the one it stopped
   * in.
   */
  pausedLine?: number | null;
}

export default function CodeEditor({
  stops,
  onToggleStop,
  pausedLine = null,
  ...props
}: CodeEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const pauseRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  /*
   * The listener is registered once, when the editor mounts, so it reads the
   * callback through a ref: a callback that changes with every render would
   * otherwise be the one the editor holds from the first frame.
   */
  const toggleRef = useRef(onToggleStop);
  useEffect(() => {
    toggleRef.current = onToggleStop;
  }, [onToggleStop]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = event.target.position?.lineNumber;
      if (line === undefined) return;
      toggleRef.current?.(line);
    });
  };

  /*
   * The stops, drawn in the margin. The effect also watches the text: an edit
   * replaces the model's contents, and the decorations go with them, so they
   * are drawn again for the file as it now reads.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !stops) return;
    const collection = decorationsRef.current ?? editor.createDecorationsCollection([]);
    decorationsRef.current = collection;
    collection.set(
      stops.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: 'breakpoint-glyph',
          glyphMarginHoverMessage: { value: 'Breakpoint — click to take it off' },
        },
      })),
    );
  }, [stops, props.value]);

  /*
   * The line the program is stopped on, marked in the text itself: the panel
   * says where it is, and the editor is where the person is looking.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const collection = pauseRef.current ?? editor.createDecorationsCollection([]);
    pauseRef.current = collection;
    if (pausedLine === null) {
      collection.set([]);
      return;
    }
    collection.set([
      {
        range: new monaco.Range(pausedLine, 1, pausedLine, 1),
        options: { isWholeLine: true, className: 'debug-line' },
      },
    ]);
  }, [pausedLine, props.value]);

  return (
    <Editor
      {...props}
      onMount={handleMount}
      options={{ ...props.options, glyphMargin: onToggleStop !== undefined }}
    />
  );
}
