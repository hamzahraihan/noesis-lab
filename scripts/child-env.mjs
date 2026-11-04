// Environment for the child processes the build scripts spawn.
//
// emsdk ships its own node and emcc runs it, so the sdk's node directory has to
// lead PATH. Two details bite on Windows: PATH entries are separated by ';'
// (hardcoding ':' merges every entry into one unusable string, so emcc cannot
// find node or its own tools), and the inherited variable may be spelled 'Path'
// rather than 'PATH', so assigning 'PATH' on a copy would leave the stale one in
// place and let the child pick whichever it sees first.
import { delimiter } from 'node:path';

// `sep` exists so the unit test can assert both platforms from either one; the
// build scripts always take the default.
export function prependPath(dir, existingPath, sep = delimiter) {
  // Forward slashes keep the entry readable and are accepted by Windows too.
  const head = dir.replace(/\\/g, '/');
  return existingPath ? `${head}${sep}${existingPath}` : head;
}

export function buildChildEnv(nodeBinDir, env = process.env, sep = delimiter) {
  if (!nodeBinDir) return { ...env };
  const inheritedKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (key.toUpperCase() === 'PATH' && key !== 'PATH') delete childEnv[key];
  }
  childEnv.PATH = prependPath(nodeBinDir, inheritedKey ? env[inheritedKey] : undefined, sep);
  return childEnv;
}

