import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';

const realBytes = () => {
  const buf = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};

function bench() {
  return { parts: [], wires: [], terminals: [], revision: 0 } as never;
}

const firmware = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
} as never;

const WORDS = new Uint16Array([0x0000, 0x0000]);

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/** Bytes for a corrupt-but-passing module: exports check ok, flash_base=1 misaligned. */
function misalignedBytes(): Promise<ArrayBuffer> {
  const sec = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
  const str = (s: string) => [...uleb(s.length), ...Buffer.from(s)];
  const t0 = [0x60, 0x00, 0x01, 0x7f];
  const t1 = [0x60, 0x00, 0x00];
  const t2 = [0x60, 0x01, 0x7f, 0x01, 0x7f];
  const t3 = [0x60, 0x02, 0x7f, 0x7f, 0x00];
  const t4 = [0x60, 0x01, 0x7f, 0x00];
  const typeSec = [...uleb(5), ...t0, ...t1, ...t2, ...t3, ...t4];
  const funcSec = [...uleb(9), 0, 1, 2, 3, 0, 4, 0, 4, 2];
  const memSec = [...uleb(1), 0x00, 0x01];
  const exp = (name: string, kind: number, idx: number) => [...str(name), kind, idx];
  const exps = [
    ...uleb(10),
    ...exp('flash_base', 0, 0), ...exp('reset_cpu', 0, 1),
    ...exp('get_reg', 0, 2), ...exp('set_reg', 0, 3),
    ...exp('get_pc', 0, 4), ...exp('set_pc', 0, 5),
    ...exp('get_sreg', 0, 6), ...exp('set_sreg', 0, 7),
    ...exp('step', 0, 8), ...exp('memory', 2, 0),
  ];
  const body = (...code: number[]) => {
    const b = [0x00, ...code, 0x0b];
    return [...uleb(b.length), ...b];
  };
  const codeSec = [
    ...uleb(9),
    ...body(0x41, 0x01), ...body(), ...body(0x41, 0x00), ...body(),
    ...body(0x41, 0x00), ...body(), ...body(0x41, 0x00), ...body(),
    ...body(0x41, 0x00),
  ];
  const mod = [
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...sec(1, typeSec), ...sec(3, funcSec), ...sec(5, memSec),
    ...sec(7, exps), ...sec(10, codeSec),
  ];
  const buf = Buffer.from(mod);
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe('worker wasm attach', () => {
  it('attaches to a flashed backend when the flag is set', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBeNull();
  });

  it('stays detached with the flag off', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', false, realBytes);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(false);
    expect(core.fault).toBeNull();
  });

  it('never attaches a stale load to a newer backend', async () => {
    let release!: (v: ArrayBuffer) => void;
    const gate = new Promise<ArrayBuffer>((res) => { release = res; });
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, () => gate);
    core.flash(WORDS);
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(WORDS);
    const buf = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
    release(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    await new Promise((r) => setTimeout(r, 800));
    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBeNull();
  });

  it('reports a corrupt-but-passing module as a wasm attach failure', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, misalignedBytes);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(false);
    expect(core.fault?.startsWith('wasm ')).toBe(true);
    expect(core.fault).toMatch(/wasm attach failed/);
  });

  it('clears a prior wasm attach failure on successful retry', async () => {
    let calls = 0;
    const flaky = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('offline'));
      return realBytes();
    };
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, flaky);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 500));
    expect(core.fault?.startsWith('wasm ')).toBe(true);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 800));
    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBeNull();
  });

  it('never clears non-wasm fault text on successful attach', async () => {
    const badFirmware = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'void setup() {\n  int x = ;\n}' }],
    } as never;
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), badFirmware, 'interpreter', true, realBytes);
    const syntaxFault = core.fault;
    expect(syntaxFault).not.toBeNull();
    expect(syntaxFault?.startsWith('wasm ')).toBe(false);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 800));
    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBe(syntaxFault);
  });
});
