/**
 * The names the editor and its callers have to agree on.
 *
 * Kept out of `monaco-setup` deliberately. That module pulls in all of Monaco
 * -- megabytes the app should not download before its first paint -- while the
 * panels need these strings whether or not the editor has loaded. Importing
 * them from here is what keeps Monaco behind `CodeEditor`'s lazy boundary.
 */

/** Arduino sketch files have no extension in the wild, so name the language. */
export const FIRMWARE_LANGUAGE = 'arduino-cpp';

/**
 * The Python the Pi runs.
 *
 * Monaco ships a Python tokenizer of its own, but it is aimed at CPython's
 * grammar -- `import`, `def`, classes, decorators -- most of which this VM
 * refuses. A name that highlights is a name that looks supported, so a
 * language is registered against what actually runs: gpiozero's constructors,
 * and the handful of builtins the interpreter answers.
 */
export const PYTHON_LANGUAGE = 'gpiozero-python';

/** Editor theme, so the code pane matches the rest of the bench. */
export const FIRMWARE_THEME = 'noesis-dark';
