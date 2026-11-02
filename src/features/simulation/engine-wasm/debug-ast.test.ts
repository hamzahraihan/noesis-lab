import { describe, it } from 'vitest';
import { loadWasmFirmware } from './firmware-bridge';

describe('ast locs', () => {
  it('prints', async () => {
    const wasm = await loadWasmFirmware();
    const src = `void foo() { delay(100); }\nvoid setup() { foo(); }\n`;
    const ast = wasm.parse(src);
    const fs = await import('node:fs');
    fs.writeFileSync('G:/Temp/tmp/ast.json', JSON.stringify(ast, null, 2));
  });
});
