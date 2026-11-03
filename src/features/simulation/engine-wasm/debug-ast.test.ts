import { describe, it } from 'vitest';
import { loadWasmFirmware } from './firmware-bridge';

describe('ast locs', () => {
  it('prints', async () => {
    const wasm = await loadWasmFirmware();
    const src = `void foo() { delay(100); }\nvoid setup() { foo(); }\n`;
    const ast = wasm.parse(src);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const outPath = path.join(os.tmpdir(), 'ast.json');
    fs.writeFileSync(outPath, JSON.stringify(ast, null, 2));
  });
});
