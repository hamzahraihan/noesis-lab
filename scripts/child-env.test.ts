import { describe, expect, it } from 'vitest';
import { delimiter } from 'node:path';
import { buildChildEnv, prependPath } from './child-env.mjs';

// Relative on purpose: the assertions below never depend on where the sdk is.
const NODE_DIR = 'emsdk/node/24.19.0_64bit';

describe('prependPath', () => {
  it('joins with a semicolon when asked for the Windows separator', () => {
    // The bug this replaces hardcoded ':'. On Windows that turns the whole PATH
    // into a single entry, so every inherited directory becomes unreachable.
    expect(prependPath(NODE_DIR, 'C:/Windows;C:/Tools', ';')).toBe(
      'emsdk/node/24.19.0_64bit;C:/Windows;C:/Tools',
    );
  });

  it('joins with a colon when asked for the Unix separator', () => {
    expect(prependPath(NODE_DIR, '/usr/bin:/bin', ':')).toBe(
      'emsdk/node/24.19.0_64bit:/usr/bin:/bin',
    );
  });

  it('defaults to the delimiter of the running platform', () => {
    expect(prependPath(NODE_DIR, 'rest')).toBe(`emsdk/node/24.19.0_64bit${delimiter}rest`);
  });

  it('writes the prepended directory with forward slashes', () => {
    expect(prependPath('C:\\emsdk\\node\\24.19.0_64bit', '', ';')).toBe(
      'C:/emsdk/node/24.19.0_64bit',
    );
  });

  it('returns the directory alone when there is no PATH to prepend to', () => {
    expect(prependPath(NODE_DIR, undefined, ';')).toBe('emsdk/node/24.19.0_64bit');
  });
});

describe('buildChildEnv', () => {
  it('keeps every inherited PATH entry addressable on this platform', () => {
    const env = buildChildEnv(NODE_DIR, { PATH: ['one', 'two'].join(delimiter) });
    expect(env.PATH.split(delimiter)).toEqual([NODE_DIR, 'one', 'two']);
  });

  it('replaces a PATH spelled Path instead of adding a second key', () => {
    const env = buildChildEnv(NODE_DIR, { Path: 'one', HOME: '/home/x' });
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
    expect(env.PATH).toBe(`emsdk/node/24.19.0_64bit${delimiter}one`);
    expect(env.HOME).toBe('/home/x');
  });

  it('copies the environment untouched when the sdk ships no node directory', () => {
    expect(buildChildEnv(null, { PATH: 'one', HOME: '/home/x' })).toEqual({
      PATH: 'one',
      HOME: '/home/x',
    });
  });

  it('does not mutate the environment it was given', () => {
    const parent = { PATH: 'one' };
    buildChildEnv(NODE_DIR, parent);
    expect(parent).toEqual({ PATH: 'one' });
  });
});
