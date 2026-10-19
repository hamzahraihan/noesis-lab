/**
 * The one way a backend gets a scripted runtime.
 *
 * The runtime and its WASM (492 KB) are loaded through a dynamic import, so a
 * bench with no scripted parts never fetches them: this module is what the
 * barrel exports, and it stays a thin loader for exactly that reason.
 */

import type { ScriptedRuntime } from './runtime';

export async function loadScriptedRuntime(): Promise<ScriptedRuntime> {
  const { createScriptedRuntime } = await import('./runtime');
  return createScriptedRuntime();
}
