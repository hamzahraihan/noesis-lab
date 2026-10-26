import { afterEach, describe, expect, it, vi } from 'vitest';
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
  max7219FromSnapshot,
  remapWithBench,
  sevenSegmentFromSnapshot,
  ssd1306FromSnapshot,
  tftFromSnapshot,
  tftImageDataFromFrame,
  tftRgbaFromFrame,
  WorkerClientImpl,
  type MirrorState,
} from './worker-client';
import {
  MAX7219_FLAG_LIT,
  MAX7219_INTENSITY_SHIFT,
  SSD1306_FLAG_LIT,
  SSD1306_FLAG_MIRRORED,
  SSD1306_FRAME_BYTES,
} from '@/features/parts';

function blankMirror(): MirrorState {
  return {
    layout: null,
    pinVolts: new Map(),
    values: new Map(),
    colon: new Map(),
    serial: [] as string[],
  };
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
    const client = createWorkerClient({
      board: { id: 'uno' } as never,
      onFallback,
      forceNoWorker: true,
    });
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

  it('returns a live client when the port handshake succeeds', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = createWorkerClient({
      board: { id: 'uno' } as never,
      bench: benchWith([]),
      firmware: plainProject(),
      onFallback,
      createPort: () => port,
    });
    expect(client).not.toBeNull();
    expect(onFallback).not.toHaveBeenCalled();
    expect(client?.status().backend).toBe('worker');
    const init = port.sent[0] as { id: number };
    const buf = allocSnapshot(layoutFor(1, 0, 16));
    headerView(buf).generation = 1;
    port.reply({ id: init.id, ok: true, buffer: buf, fault: null });
    expect(client?.poll()).toBe('ok');
    client?.dispose();
  });

  it('takes the worker’s debug status over its own staged build', () => {
    const port = fakePort();
    const client = createWorkerClient({
      board: { id: 'uno' } as never,
      bench: benchWith([]),
      firmware: plainProject(),
      execution: 'avr',
      onFallback: () => {},
      createPort: () => port,
    });
    const init = port.sent[0] as { id: number };
    const buf = allocSnapshot(layoutFor(1, 0, 16));
    headerView(buf).generation = 1;
    port.reply({
      id: init.id,
      ok: true,
      buffer: buf,
      fault: null,
      debugWatchable: true,
      debugCompiled: false,
    });
    // The AVR build failed onto the interpreter: stops still work, but the
    // panel must not call this a compiled run.
    expect(client?.debugWatchable()).toBe(true);
    expect(client?.debugCompiled()).toBe(false);
    client?.dispose();
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

  it('splits an OLED frame and its flags per part', () => {
    const bench = benchWith([
      { id: 'oled', def: partDef('display', { controller: 'ssd1306' }), pins: [] },
    ]);
    const buf = allocSnapshot(layoutFor(1, 0, SSD1306_FRAME_BYTES + 1));
    displayView(buf).write(0, 0x01);
    displayView(buf).write(SSD1306_FRAME_BYTES, SSD1306_FLAG_LIT);
    headerView(buf).generation = 4;
    const state = blankMirror();
    expect(ingestSnapshot(state, buf)).toBe('ok');
    remapWithBench(state, bench);
    const bytes = state.values.get('oled');
    expect(bytes).toHaveLength(SSD1306_FRAME_BYTES + 1);
    expect(bytes?.[0]).toBe(0x01);
    expect(bytes?.[SSD1306_FRAME_BYTES]).toBe(SSD1306_FLAG_LIT);
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

  it('rebuilds an OLED frame and the state that goes with it', () => {
    const frame = new Uint8Array(SSD1306_FRAME_BYTES);
    // The pixel at column 0, page 0, the top row.
    frame[0] = 0x01;
    const panel = ssd1306FromSnapshot(frame, SSD1306_FLAG_LIT | SSD1306_FLAG_MIRRORED);
    expect(panel.isLit(0, 0)).toBe(true);
    expect(panel.isLit(1, 0)).toBe(false);
    expect(panel.lit).toBe(true);
    expect(panel.mirrored).toBe(true);
  });

  it('rebuilds a matrix frame, its shutdown state and its brightness', () => {
    const frame = [0x0e, 0x3f, 0x7f, 0xfe, 0xfe, 0x7e, 0x3f, 0x0e];
    const glass = max7219FromSnapshot(frame, MAX7219_FLAG_LIT | (0x0f << MAX7219_INTENSITY_SHIFT));
    expect(glass.lit).toBe(true);
    expect(glass.isLit(0, 1)).toBe(true);
    expect(glass.isLit(0, 0)).toBe(false);
    expect(glass.isLit(3, 7)).toBe(true);
    expect(glass.brightness).toBe(1);
    // The frame says shut down, so the registers are there and the glass is dark.
    const dark = max7219FromSnapshot(frame, 0);
    expect(dark.lit).toBe(false);
    expect(dark.isLit(0, 1)).toBe(false);
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

      const panel = tftFromSnapshot(
        frame?.width ?? 0,
        frame?.height ?? 0,
        frame?.rgb565 ?? new Uint8Array(0),
      );
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

  it('accepts the real Uno PartDefinition (catalogue id, mcu board uno)', async () => {
    const { arduinoUnoR3 } = await import('@/features/parts');
    const calls: string[] = [];
    const client = new WorkerClientImpl(arduinoUnoR3() as never, stubs(calls));
    await client.compileAndRun(plainProject());
    expect(calls).toEqual(['single']);
    expect(client.fault).toBeNull();
    client.dispose();
  });

  it('passes the packaged line map to a single-TU build and stages its debug rows', async () => {
    const seen: { lineMap?: readonly unknown[] } = {};
    const debug = { lines: [{ pc: 2, file: 'main.ino', line: 1 }] };
    const client = new WorkerClientImpl({ id: 'uno' } as never, {
      avrCompile: (async (
        _source: string,
        _progress: unknown,
        _signal: unknown,
        lineMap: readonly unknown[],
      ) => {
        seen.lineMap = lineMap;
        return { hex: new Uint16Array([1]), warnings: [], debug };
      }) as never,
    });
    client.setExecution('avr');
    // Nothing has been built yet, so there is nothing to promise.
    expect(client.debugWatchable()).toBe(false);
    expect(client.debugCompiled()).toBe(false);

    await client.compileAndRun(plainProject());

    expect(seen.lineMap?.length).toBeGreaterThan(0);
    expect(client.debugWatchable()).toBe(true);
    expect(client.debugCompiled()).toBe(true);
    client.dispose();
  });

  it('drops staged debug rows when a build fails', async () => {
    let failing = false;
    const debug = { lines: [{ pc: 2, file: 'main.ino', line: 1 }] };
    const client = new WorkerClientImpl({ id: 'uno' } as never, {
      avrCompile: (async () => {
        if (failing) throw new Error('boom');
        return { hex: new Uint16Array([1]), warnings: [], debug };
      }) as never,
    });
    client.setExecution('avr');
    await client.compileAndRun(plainProject());
    expect(client.debugWatchable()).toBe(true);

    failing = true;
    await client.compileAndRun(plainProject());

    expect(client.fault).toMatch(/compile failed/);
    // With no bundled HEX the worker lands on its interpreter runner, which
    // the debugger can still watch; the AVR core is gone, not the debugger.
    expect(client.debugWatchable()).toBe(true);
    expect(client.debugCompiled()).toBe(false);
    client.dispose();
  });
});

/** Injected fake port: records posts, replays worker replies synchronously. */
interface FakePort {
  readonly sent: unknown[];
  onmessage: ((event: { data: unknown }) => void) | null;
  terminated: boolean;
  postMessage(msg: unknown): void;
  terminate(): void;
  reply(data: unknown): void;
}

function fakePort(): FakePort {
  const port: FakePort = {
    sent: [],
    onmessage: null,
    terminated: false,
    postMessage(msg: unknown): void {
      port.sent.push(msg);
    },
    terminate(): void {
      port.terminated = true;
    },
    reply(data: unknown): void {
      port.onmessage?.({ data });
    },
  };
  return port;
}

function portClient(
  port: FakePort,
  onFallback: (reason: string) => void,
  deps?: ConstructorParameters<typeof WorkerClientImpl>[1],
): NonNullable<ReturnType<typeof createWorkerClient>> {
  const client = createWorkerClient({
    board: { id: 'uno' } as never,
    bench: benchWith([]),
    firmware: plainProject(),
    onFallback,
    createPort: () => port,
    ...(deps === undefined ? {} : { deps }),
  });
  if (client === null) throw new Error('expected a live port client');
  return client;
}

function replyInitOk(port: FakePort, timeMs = 0): SharedArrayBuffer {
  const init = port.sent[0] as { id: number; type: string };
  expect(init.type).toBe('init');
  const buf = allocSnapshot(layoutFor(1, 0, 16));
  headerView(buf).generation = 1;
  headerView(buf).timeMs = timeMs;
  port.reply({ id: init.id, ok: true, buffer: buf, fault: null });
  return buf;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('worker port protocol', () => {
  it('sends init with bench, firmware, and execution, then lands the first frame', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const bench = benchWith([]);
    const firmware = plainProject();
    const client = createWorkerClient({
      board: { id: 'uno' } as never,
      bench,
      firmware,
      onFallback,
      createPort: () => port,
    });
    expect(client).not.toBeNull();
    const init = port.sent[0] as Record<string, unknown>;
    expect(init.type).toBe('init');
    expect(init.bench).toBe(bench);
    expect(init.firmware).toBe(firmware);
    expect(init.execution).toBe('interpreter');
    const buf = allocSnapshot(layoutFor(1, 0, 16));
    headerView(buf).generation = 1;
    headerView(buf).timeMs = 120;
    port.reply({ id: init.id, ok: true, buffer: buf, fault: null });
    expect(client?.poll()).toBe('ok');
    expect(client?.timeMs).toBe(120);
    expect(onFallback).not.toHaveBeenCalled();
    const ack = port.sent.find((msg) => (msg as { type?: string }).type === 'ack') as
      | { type: string; generation: number }
      | undefined;
    expect(ack?.generation).toBe(1);
    client?.dispose();
  });

  it('reports script faults from the worker as rows the Problems panel can render', () => {
    const port = fakePort();
    const client = portClient(port, vi.fn());
    const buf = replyInitOk(port);
    // The refresh rides the frame poll: thirty frames is half a second.
    const frame = (generation: number): void => {
      headerView(buf).generation = generation;
      client.poll();
    };
    for (let i = 0; i < 30; i++) frame(i + 2);
    const ask = port.sent.find((msg) => (msg as { type?: string }).type === 'faults') as
      | { id: number; type: string }
      | undefined;
    expect(ask?.type).toBe('faults');
    port.reply({
      id: ask?.id,
      ok: true,
      rows: [{ partId: 'p3', fault: 'Error: no sensor' }],
    });
    expect(client.faults()).toEqual([{ partId: 'p3', fault: 'Error: no sensor' }]);
    client.dispose();
  });

  it('carries the stops with the sketch, and takes the frame the worker pushes', () => {
    const port = fakePort();
    const client = portClient(port, vi.fn());
    replyInitOk(port);
    client.setStops([{ file: 'main.ino', line: 3 }]);
    // The stops ride with the next sketch the worker builds: a stop that
    // arrived after the build would be a stop the sketch had passed.
    client.loadFirmware(plainProject());
    const init = port.sent.filter((msg) => (msg as { type?: string }).type === 'init').at(-1) as
      | { stops?: unknown }
      | undefined;
    expect(init?.stops).toEqual([{ file: 'main.ino', line: 3 }]);
    // The worker pushes the frame when the program stops.
    port.reply({
      type: 'debug-paused',
      frame: {
        file: 'main.ino',
        line: 3,
        column: 1,
        depth: 0,
        variables: [{ name: 'x', value: '1', scope: 'global' }],
      },
    });
    expect(client.debugPaused()).toBe(true);
    expect(client.debugFrame()?.line).toBe(3);
    expect(client.debugFrame()?.variables).toEqual([{ name: 'x', value: '1', scope: 'global' }]);
    // The three questions the panel's buttons ask.
    client.resumeDebug();
    client.stepDebug('over');
    client.stepDebug('into');
    const types = port.sent.map((msg) => (msg as { type?: string }).type);
    expect(types).toContain('debug-resume');
    expect(types).toContain('debug-step');
    port.reply({ type: 'debug-resumed' });
    expect(client.debugPaused()).toBe(false);
    client.dispose();
  });

  it('carries a compiled stop across the worker boundary with PC and registers', () => {
    const port = fakePort();
    const client = portClient(port, vi.fn());
    replyInitOk(port);
    port.reply({
      type: 'debug-paused',
      frame: {
        file: 'main.ino',
        line: 2,
        column: 0,
        depth: 0,
        variables: [],
        pc: 4,
        compiled: true,
        registers: [
          { name: 'r0', value: '0x00' },
          { name: 'PC', value: '0x4' },
        ],
      },
    });

    const frame = client.debugFrame();
    expect(frame?.pc).toBe(4);
    expect(frame?.compiled).toBe(true);
    expect(frame?.registers).toEqual([
      { name: 'r0', value: '0x00' },
      { name: 'PC', value: '0x4' },
    ]);
    client.dispose();
  });

  it('flashes the compiled debug rows beside the words', async () => {
    const port = fakePort();
    const debug = { lines: [{ pc: 2, file: 'main.ino', line: 1 }] };
    const client = portClient(port, vi.fn(), {
      avrCompile: (async () => ({
        hex: new Uint16Array([1]),
        warnings: [],
        debug,
      })) as never,
    });
    client.setExecution('avr');
    replyInitOk(port);
    port.sent.length = 0;

    await client.compileAndRun(plainProject());

    const flash = port.sent.find((msg) => (msg as { type?: string }).type === 'flash') as
      | { words: Uint16Array; debug?: unknown }
      | undefined;
    expect(flash).toBeDefined();
    expect(Array.from(flash?.words ?? [])).toEqual([1]);
    expect(flash?.debug).toEqual(debug);
    client.dispose();
  });

  it('reports the firmware verdict when a sketch stops with an error', () => {
    const port = fakePort();
    const client = portClient(port, vi.fn());
    const buf = replyInitOk(port);
    const frame = (generation: number): void => {
      headerView(buf).generation = generation;
      client.poll();
    };
    for (let i = 0; i < 30; i++) frame(i + 2);
    const ask = port.sent.find(
      (msg): msg is { id: number; type: string } =>
        typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'faults',
    );
    /*
     * A sketch that raised an error it did not catch stops in the worker,
     * and the reason travels with the rows: the page says why the bench went
     * quiet instead of showing a sketch that simply stopped.
     */
    port.reply({
      id: ask?.id,
      ok: true,
      rows: [],
      fault: "NameError: name 'sorted' is not defined",
    });
    expect(client.fault).toBe("NameError: name 'sorted' is not defined");
    client.dispose();
  });

  it('sends the rp2040 execution when the build asks for it', () => {
    const port = fakePort();
    const client = createWorkerClient({
      board: { id: 'rp2040' } as never,
      bench: benchWith([]),
      firmware: plainProject(),
      execution: 'rp2040',
      onFallback: vi.fn(),
      createPort: () => port,
    });
    expect(client).not.toBeNull();
    const init = port.sent[0] as Record<string, unknown>;
    expect(init.execution).toBe('rp2040');
    replyInitOk(port);
    expect(client?.poll()).toBe('ok');
    client?.dispose();
  });

  it('falls back when the handshake reports a version mismatch', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = portClient(port, onFallback);
    expect(client).not.toBeNull();
    const init = port.sent[0] as { id: number };
    port.reply({ id: init.id, ok: false, error: 'snapshot version mismatch' });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(port.terminated).toBe(true);
    client.dispose();
  });

  it('posts start, stop, press, knob, edit, and flash in order', async () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const calls: string[] = [];
    const client = portClient(port, onFallback, {
      avrCompile: (async () => {
        calls.push('single');
        return { hex: new Uint16Array([1]), warnings: [] };
      }) as never,
    });
    replyInitOk(port);
    expect(client.poll()).toBe('ok');
    port.sent.length = 0;
    client.start();
    client.stop();
    client.setPressed('b1', true);
    client.setKnob('k1', { id: 'knob', min: 0, max: 100 } as never, 42);
    client.sendBench(benchWith([]));
    await client.compileAndRun(plainProject());
    const types = port.sent.map((msg) => (msg as { type: string }).type);
    expect(types).toEqual(['start', 'stop', 'press', 'knob', 'edit', 'init', 'flash']);
    const press = port.sent[2] as { partId: string; down: boolean };
    expect(press.partId).toBe('b1');
    expect(press.down).toBe(true);
    const knob = port.sent[3] as { partId: string; value: number };
    expect(knob.partId).toBe('k1');
    expect(knob.value).toBe(42);
    const flash = port.sent[6] as { words: Uint16Array };
    expect(Array.from(flash.words)).toEqual([1]);
    expect(calls).toEqual(['single']);
    expect(onFallback).not.toHaveBeenCalled();
    client.dispose();
  });

  it('posts the speed multiplier for the worker tick', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = portClient(port, onFallback);
    replyInitOk(port);
    expect(client.poll()).toBe('ok');
    port.sent.length = 0;
    client.setSpeed(2);
    const speed = port.sent[0] as { type: string; scale: number };
    expect(speed.type).toBe('speed');
    expect(speed.scale).toBe(2);
    expect(onFallback).not.toHaveBeenCalled();
    client.dispose();
  });

  it('lands the realloc reply as a new buffer', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = portClient(port, onFallback);
    replyInitOk(port);
    expect(client.poll()).toBe('ok');
    client.sendBench(benchWith([]));
    const edit = port.sent.find((msg) => (msg as { type?: string }).type === 'edit') as
      | { id: number }
      | undefined;
    expect(edit).toBeDefined();
    const next = allocSnapshot(layoutFor(9, 2, 8, 16));
    headerView(next).generation = 0;
    port.reply({ id: edit?.id ?? -1, ok: true, realloc: true, buffer: next, fault: null });
    expect(client.poll()).toBe('reallocated');
    expect(onFallback).not.toHaveBeenCalled();
    client.dispose();
  });

  it('demotes to in-page fallback on a fault reply', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = portClient(port, onFallback);
    replyInitOk(port);
    expect(client.poll()).toBe('ok');
    port.reply({ id: 999999, ok: false, error: 'sim worker crashed' });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(port.terminated).toBe(true);
    client.dispose();
  });

  it('stays live on a firmware verdict, with fault text set and no terminate', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = portClient(port, onFallback);
    const buf = replyInitOk(port);
    expect(client.poll()).toBe('ok');
    client.sendBench(benchWith([]));
    const edit = port.sent.find((msg) => (msg as { type?: string }).type === 'edit') as
      | { id: number }
      | undefined;
    expect(edit).toBeDefined();
    // The worker is alive but the sketch failed: a verdict, not a transport
    // fault. The client surfaces it and awaits the next Run.
    port.reply({ id: edit?.id ?? -1, ok: true, fault: 'main.ino:3: expected ;' });
    expect(client.fault).toBe('main.ino:3: expected ;');
    expect(onFallback).not.toHaveBeenCalled();
    expect(port.terminated).toBe(false);
    // Still live: inputs still post and frames still ingest.
    client.setPressed('b1', true);
    expect(port.sent.at(-1)).toMatchObject({ type: 'press', partId: 'b1', down: true });
    headerView(buf).bump();
    expect(client.poll()).toBe('ok');
    client.dispose();
  });

  it('second init collapses queued edits with the latest bench winning', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const benchA = benchWith([]);
    const firmwareA = plainProject();
    const client = createWorkerClient({
      board: { id: 'uno' } as never,
      bench: benchA,
      firmware: firmwareA,
      onFallback,
      createPort: () => port,
    });
    if (client === null) throw new Error('expected a live port client');
    const init1 = port.sent[0] as { id: number; type: string };
    expect(init1.type).toBe('init');
    // Two structural edits land while the handshake is in flight: queued,
    // never posted yet.
    const benchB = benchWith([]);
    const benchC = benchWith([]);
    client.sendBench(benchB);
    client.sendBench(benchC);
    expect(port.sent).toHaveLength(1);
    // A new sketch rebuilds immediately with the latest bench, not the one
    // the first init carried.
    const firmwareB = plainProject();
    client.loadFirmware(firmwareB);
    const init2 = port.sent[1] as Record<string, unknown>;
    expect(init2.type).toBe('init');
    expect(init2.bench).toBe(benchC);
    expect(init2.firmware).toBe(firmwareB);
    // Handshake replies land in order; the second init's buffer is the live
    // frame, so the latest bench wins regardless of the queued edits.
    const buf1 = allocSnapshot(layoutFor(1, 0, 16));
    headerView(buf1).generation = 1;
    headerView(buf1).timeMs = 111;
    port.reply({ id: init1.id, ok: true, buffer: buf1, fault: null });
    const buf2 = allocSnapshot(layoutFor(1, 0, 16));
    headerView(buf2).generation = 1;
    headerView(buf2).timeMs = 777;
    port.reply({ id: (init2.id as number) ?? -1, ok: true, buffer: buf2, fault: null });
    expect(client.poll()).toBe('ok');
    expect(client.timeMs).toBe(777);
    expect(onFallback).not.toHaveBeenCalled();
    expect(port.terminated).toBe(false);
    client.dispose();
  });

  it('computes ratio from timeMs advance over the wall window', () => {
    const onFallback = vi.fn();
    const port = fakePort();
    const client = portClient(port, onFallback);
    const buf = replyInitOk(port, 0);
    const head = headerView(buf);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    expect(client.poll()).toBe('ok');
    head.bump();
    head.timeMs = 600;
    now.mockReturnValue(600);
    expect(client.poll()).toBe('ok');
    expect(client.status().ratio).toBeCloseTo(1, 10);
    head.bump();
    head.timeMs = 1800;
    now.mockReturnValue(1200);
    expect(client.poll()).toBe('ok');
    // The 1000 ms window drops the wall-0 sample (1200 - 0 > 1000), keeping
    // 1200 ms of simulated time over 600 ms of wall clock.
    expect(client.status().ratio).toBeCloseTo(2, 10);
    client.dispose();
  });

  /*
   * The worker owns its own network, so the flag that lets it bridge to real
   * hosts has to travel in `init` -- and has to default to false, because the
   * worker cannot see a build's data and must never bridge on a guess.
   */
  it('carries the live-network opt-in in init, false by default', () => {
    const port = fakePort();
    createWorkerClient({
      board: { id: 'uno' } as never,
      bench: benchWith([]),
      firmware: plainProject(),
      liveNetwork: true,
      onFallback: vi.fn(),
      createPort: () => port,
    });
    expect((port.sent[0] as { liveNetwork?: boolean }).liveNetwork).toBe(true);

    const plainPort = fakePort();
    createWorkerClient({
      board: { id: 'uno' } as never,
      bench: benchWith([]),
      firmware: plainProject(),
      onFallback: vi.fn(),
      createPort: () => plainPort,
    });
    expect((plainPort.sent[0] as { liveNetwork?: boolean }).liveNetwork).toBe(false);
  });
});
