import { describe, expect, it, vi } from 'vitest';
import {
  allocSnapshot,
  displayView,
  headerView,
  layoutFor,
  netView,
  pinNodeView,
  tftView,
} from '@/features/simulation/sim-worker/protocol';
import {
  createWorkerClient,
  ingestSnapshot,
  lcdFromSnapshot,
  remapWithBench,
  sevenSegmentFromSnapshot,
  tftFromSnapshot,
  tftImageDataFromFrame,
  tftRgbaFromFrame,
  WorkerClientImpl,
  type MirrorState,
} from './worker-client';

function blankMirror(): MirrorState {
  return { layout: null, pinVolts: new Map(), values: new Map(), colon: new Map(), serial: [] as string[] };
}

function partDef(kind: string, extra?: Record<string, unknown>): never {
  return { id: `def-${kind}`, component: { kind, ...extra } } as never;
}

function benchWith(parts: Array<{ id: string; def: never; pins: readonly string[] }>): never {
  return {
    parts: parts.map((entry, partIndex) => ({
      id: entry.id,
      definition: entry.def,
      x: partIndex * 10,
      y: 0,
      rotation: 0,
      terminals: Object.fromEntries(entry.pins.map((pin) => [pin, `${entry.id}:${pin}`])),
    })),
    wires: [],
    terminals: [],
    revision: 0,
  } as never;
}

function plainProject(): never {
  return {
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
  } as never;
}

describe('worker client fallback', () => {
  it('falls back when workers are unavailable', () => {
    const onFallback = vi.fn();
    const client = createWorkerClient({ board: { id: 'uno' } as never, onFallback, forceNoWorker: true });
    expect(client).toBeNull();
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('rebinds across an SHM realloc without mixing layouts', () => {
    const state = blankMirror();
    const a = allocSnapshot(layoutFor(4, 2, 8, 16));
    headerView(a).generation = 1;
    expect(ingestSnapshot(state, a)).toBe('ok');
    expect(ingestSnapshot(state, a)).toBe('stale');
    const b = allocSnapshot(layoutFor(9, 2, 8, 16));
    headerView(b).generation = 1;
    expect(ingestSnapshot(state, b)).toBe('reallocated');
    expect(ingestSnapshot(state, b)).toBe('stale');
  });

  it('returns a live client when Worker, SHM, and handshake succeed', () => {
    const previous = (globalThis as Record<string, unknown>).Worker;
    (globalThis as Record<string, unknown>).Worker = class {};
    try {
      const onFallback = vi.fn();
      const client = createWorkerClient({ board: { id: 'uno' } as never, onFallback });
      expect(client).not.toBeNull();
      expect(onFallback).not.toHaveBeenCalled();
      expect(client?.status().backend).toBe('worker');
      client?.dispose();
    } finally {
      (globalThis as Record<string, unknown>).Worker = previous;
    }
  });
});

describe('mirror remap', () => {
  it('maps pin slots to part pins and excludes breadboard holes', () => {
    const bench = benchWith([
      { id: 's1', def: partDef('servo'), pins: ['GND', 'V+', 'PWM'] },
      { id: 'bb', def: partDef('breadboard'), pins: ['r1', 'r2'] },
    ]);
    const buf = allocSnapshot(layoutFor(2, 5, 16));
    netView(buf).write(0, 5);
    netView(buf).write(1, 1.2);
    pinNodeView(buf).write(0, 0);
    pinNodeView(buf).write(1, 1);
    pinNodeView(buf).write(2, 0);
    pinNodeView(buf).write(3, 1);
    pinNodeView(buf).write(4, 0);
    headerView(buf).generation = 7;
    const client = new WorkerClientImpl({ id: 'uno' } as never);
    client.sendBench(bench);
    client.attachBuffer(buf);
    expect(client.poll()).toBe('ok');
    expect(client.pinVoltages().get('s1:GND')).toBe(5);
    expect(client.pinVoltages().get('s1:V+')).toBe(1.2);
    expect(client.pinVoltages().get('s1:PWM')).toBe(5);
    expect(client.pinVoltages().has('bb:r1')).toBe(false);
    expect(client.pinVoltages().size).toBe(3);
    client.dispose();
  });

  it('splits display bytes per part and lifts the colon flag', () => {
    const bench = benchWith([
      { id: 'clock', def: partDef('7segment', { digits: 2 }), pins: [] },
      { id: 'horn', def: partDef('servo'), pins: [] },
    ]);
    const buf = allocSnapshot(layoutFor(1, 0, 4));
    displayView(buf).write(0, 0x3f);
    displayView(buf).write(1, 0x06);
    displayView(buf).write(2, 1);
    displayView(buf).write(3, 120);
    headerView(buf).generation = 3;
    const state = blankMirror();
    expect(ingestSnapshot(state, buf)).toBe('ok');
    remapWithBench(state, bench);
    expect(state.values.get('clock')).toEqual([0x3f, 0x06, 1]);
    expect(state.values.get('horn')).toEqual([120]);
    expect(state.colon.get('clock')).toBe(true);
  });
});

describe('display adapters', () => {
  it('rebuilds latched 7-segment patterns and the colon', () => {
    const lit = sevenSegmentFromSnapshot(2, [0x3f, 0x06], true, 5);
    expect(Array.from(lit.patterns())).toEqual([0x3f, 0x06]);
    expect(lit.colonLit).toBe(true);
    const dark = sevenSegmentFromSnapshot(1, [0x00], false, 5);
    expect(Array.from(dark.patterns())).toEqual([0]);
    expect(dark.colonLit).toBe(false);
  });

  it('replays LCD text, shape, and backlight', () => {
    const def = { id: 'lcd', component: { kind: 'lcd', variant: '1602' } } as never;
    const text = 'hello';
    const encoded = new TextEncoder().encode(text);
    const bytes = [...encoded, ...new Array(80 - encoded.length).fill(0)];
    const panel = lcdFromSnapshot(def, bytes, 0x02);
    expect(panel?.shape).toEqual({ columns: 16, rows: 2 });
    expect(panel?.text().split('\n')[0]?.slice(0, 5)).toBe('hello');
    expect(panel?.backlightOn).toBe(true);
  });
});

describe('tft mirror decode', () => {
  // A 2x2 frame with one primary per pixel: red, green / blue, white.
  const frameBytes = new Uint8Array([0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f, 0xff, 0xff]);

  /** `ImageData` does not exist in the node test env; stub it if missing. */
  function ensureImageData(): () => void {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.ImageData !== 'undefined') return () => {};
    g.ImageData = class {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;
      constructor(data: Uint8ClampedArray, width: number, height?: number) {
        this.data = data;
        this.width = width;
        this.height = height ?? data.length / 4 / width;
      }
    };
    return () => {
      delete g.ImageData;
    };
  }

  function clientWithFrame(width: number, height: number, rgb565: Uint8Array): WorkerClientImpl {
    const buf = allocSnapshot(layoutFor(1, 0, 16));
    tftView(buf).writeFrame(width, height, rgb565);
    const client = new WorkerClientImpl({ id: 'uno' } as never);
    client.sendBench(benchWith([]));
    client.attachBuffer(buf);
    expect(client.poll()).toBe('ok');
    return client;
  }

  it('round-trips a frame through writeFrame, readFrame, and mirror decode, pixel-identical', () => {
    const restore = ensureImageData();
    try {
      const client = clientWithFrame(2, 2, frameBytes);
      const frame = client.tftSnapshot();
      expect(frame?.width).toBe(2);
      expect(frame?.height).toBe(2);
      expect(frame?.rgb565).toEqual(frameBytes);

      const panel = tftFromSnapshot(frame?.width ?? 0, frame?.height ?? 0, frame?.rgb565 ?? new Uint8Array(0));
      expect(panel?.pixelAt(0, 0)).toBe(0xf800);
      expect(panel?.pixelAt(1, 0)).toBe(0x07e0);
      expect(panel?.pixelAt(0, 1)).toBe(0x001f);
      expect(panel?.pixelAt(1, 1)).toBe(0xffff);

      const rgba = tftRgbaFromFrame(2, 2, frameBytes);
      expect(Array.from(rgba)).toEqual([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
      ]);

      const image = tftImageDataFromFrame(2, 2, frameBytes);
      expect(image.width).toBe(2);
      expect(image.height).toBe(2);
      expect(Array.from(image.data)).toEqual(Array.from(rgba));
      client.dispose();
    } finally {
      restore();
    }
  });

  it('reports no TFT frame, without copying bytes, on the empty fast path', () => {
    const client = clientWithFrame(0, 0, new Uint8Array(0));
    expect(client.tftSnapshot()).toBeNull();
    client.dispose();

    const buf = allocSnapshot(layoutFor(1, 0, 16));
    tftView(buf).writeFrame(0, 0, new Uint8Array(0));
    const frame = tftView(buf).readFrame();
    expect(frame.width).toBe(0);
    expect(frame.height).toBe(0);
    expect(frame.rgb565).toHaveLength(0);
    expect(tftFromSnapshot(frame.width, frame.height, frame.rgb565)).toBeNull();
  });
});

describe('poll status and overflow', () => {
  it('tracks fps and a sticky serial overflow', () => {
    const buf = allocSnapshot(layoutFor(1, 0, 16, 8));
    const head = headerView(buf);
    for (let i = 0; i < 20; i++) head.serialPush(i);
    expect(head.overflow).toBe(1);
    head.generation = 1;
    const client = new WorkerClientImpl({ id: 'uno' } as never);
    client.sendBench(benchWith([]));
    client.attachBuffer(buf);
    expect(client.poll()).toBe('ok');
    expect(client.serialOverflow).toBe(true);
    expect(client.status().backend).toBe('worker');
    expect(client.status().fps).toBeGreaterThanOrEqual(1);
    expect(client.serialLines().length).toBe(1);
    expect(client.poll()).toBe('stale');
    head.bump();
    expect(client.poll()).toBe('ok');
    client.dispose();
  });
});

describe('compile routing', () => {
  function stubs(calls: string[]): {
    avrCompile: never;
    avrProjectCompile: never;
  } {
    return {
      avrCompile: (async () => {
        calls.push('single');
        return { hex: new Uint16Array([1]), warnings: [] };
      }) as never,
      avrProjectCompile: (async () => {
        calls.push('multi');
        return { hex: new Uint16Array([1]), warnings: [] };
      }) as never,
    };
  }

  it('routes plain projects through the single-TU path', async () => {
    const calls: string[] = [];
    const client = new WorkerClientImpl({ id: 'uno' } as never, stubs(calls));
    await client.compileAndRun(plainProject());
    expect(calls).toEqual(['single']);
    expect(client.fault).toBeNull();
    client.dispose();
  });

  it('routes declared-library builds through the multi-TU path', async () => {
    const calls: string[] = [];
    const client = new WorkerClientImpl({ id: 'uno' } as never, stubs(calls));
    await client.compileAndRun({
      ...(plainProject() as unknown as Record<string, unknown>),
      libraries: [{ name: 'Servo', source: 'provided' }],
    } as never);
    expect(calls).toEqual(['multi']);
    expect(client.fault).toBeNull();
    client.dispose();
  });

  it('refuses non-Uno boards without touching the toolchain', async () => {
    const calls: string[] = [];
    const client = new WorkerClientImpl({ id: 'mega2560' } as never, stubs(calls));
    await client.compileAndRun(plainProject());
    expect(calls).toEqual([]);
    expect(client.fault).toMatch(/Uno/);
    client.dispose();
  });
});
