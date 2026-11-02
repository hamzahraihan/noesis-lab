import { describe, it, expect } from 'vitest';
import { instantiateFirmware } from './firmware';

describe('debug smoke', () => {
  it('stops at breakpoint and reports call stack', async () => {
    const src = `void foo() {\n  delay(100);\n}\nvoid setup() {\n  foo();\n}\n`;
    const wasm = await instantiateFirmware();
    wasm.loadSketch(src);
    wasm.setBreakpoint('main.ino', 2);
    wasm.run(200);
    const state = JSON.parse(wasm.getDebugState());
    console.log(JSON.stringify(state));
    expect(state.hitBreakpoint).toBe(true);
    expect(state.frames[0].function).toBe('foo');
    expect(state.frames[1].function).toBe('setup');
    wasm.destroy();
  });
});
