/**
 * Types for the shared export list. The list itself lives in the `.mjs` file
 * so the Node build scripts and the tests read one source; this declaration
 * exists because the app's tsconfig does not enable `allowJs`.
 */
export const ENGINE_EXPORTS: readonly string[];
