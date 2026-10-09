import { describe, expect, it, vi } from 'vitest';
import { buildCustomObjects } from './custom';

const cpp = (name: string, body: string) => ({ path: name, content: body });

describe('custom slot builds', () => {
  it('compiles each cpp and preserves order, pruning non-source dirs', async () => {
    const seen: string[] = [];
    const seenHeaders: Array<ReadonlyMap<string, string>> = [];
    const compileUnit = vi.fn(async (source: string, headers: ReadonlyMap<string, string>) => {
      seen.push(source.slice(0, 12));
      seenHeaders.push(headers);
      if (seenHeaders.length === 1) (headers as Map<string, string>).set('INJECTED', 'evil');
      return new Uint8Array([seen.length]);
    });
    const slot = {
      id: 'm',
      name: 'MyLib',
      files: [
        cpp('MyLib.h', '#pragma once\nint f();\n'),
        cpp('MyLib.cpp', '#include "MyLib.h"\nint f(){return 1;}\n'),
        cpp('extra.cpp', 'int g(){return 2;}\n'),
        cpp('examples/demo.ino', 'void setup(){}\n'),
        cpp('docs/readme.txt', 'hi'),
      ],
    };
    const out = await buildCustomObjects(slot, compileUnit);
    expect(compileUnit).toHaveBeenCalledTimes(2);
    expect(out.objects.map((o) => [...o])).toEqual([[1], [2]]);
    expect(out.diagnostics).toEqual([]);
    expect(seenHeaders).toHaveLength(2);
    for (const headers of seenHeaders) {
      expect(headers.get('MyLib.h')).toBe('#pragma once\nint f();\n');
    }
    expect(seenHeaders[0]).not.toBe(seenHeaders[1]);
    expect(seenHeaders[1]?.has('INJECTED')).toBe(false);
  });

  it('reports header-only slots instead of failing', async () => {
    const out = await buildCustomObjects(
      { id: 'h', name: 'H', files: [cpp('H.h', '#pragma once\n')] },
      async () => new Uint8Array([9]),
    );
    expect(out.objects).toEqual([]);
    expect(out.diagnostics).toEqual(['<H>: no compilable sources']);
  });
});
