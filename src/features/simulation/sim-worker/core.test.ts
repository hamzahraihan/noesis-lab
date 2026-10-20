import { describe, expect, it, vi } from 'vitest';
import { createSimCore } from './core';
import { serialRing, tftView } from './protocol';
import {
  ingestSnapshot,
  tftFromMirror,
  tftFromSnapshot,
  tftRgbaFromFrame,
  type MirrorState,
} from '@/features/bench/simulations/worker-client';
import { Simulation } from '@/features/bench/simulations/simulation';
import { boardOption } from '@/features/learn/boardRegistry';
import { exerciseById } from '@/features/learn';
import { CIRCUITS } from '@/features/learn/circuits';
import { esp32DevKitV1, ili9341Definition, type Ili9341 } from '@/features/parts';
import type { NetAnswer, NetFetcher } from '@/features/simulation';
import { clearReportedFaults } from '../scripted/diagnostics';

describe('sim core', () => {
  it('steps an interpreter blink without Worker globals', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
      } as never,
      'interpreter',
    );
    core.step(16);
    expect(core.timeMs).toBeGreaterThan(0);
    expect(core.fault).toBeNull();
  });

  it('reports a script fault from the worker realm as a Problems row', async () => {
    clearReportedFaults();
    const sim = new Simulation(boardOption('uno').make());
    const doc = CIRCUITS['soil-probe'];
    const broken = {
      ...doc,
      definitions: (doc.definitions ?? []).map((definition) => ({
        ...definition,
        script: '({ analog: () => { throw new Error("no sensor"); } })',
      })),
    };
    expect(sim.loadCircuit(broken)).toEqual([]);

    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      sim.bench,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [
          {
            name: 'main.ino',
            content:
              '#include <Arduino.h>\nvoid setup() {}\nvoid loop() { Serial.println(analogRead(A0)); delay(100); }',
          },
        ],
      } as never,
      'interpreter',
    );
    await core.scriptedReady();
    for (let i = 0; i < 30; i++) core.step(16);

    // The row is the worker realm's own latch: the same module the sampler
    // wrote is what the message channel reads.
    const rows = core.faults();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.partId).toBe('p3');
    expect(rows[0]?.fault).toContain('no sensor');
    clearReportedFaults();
  });

  it('pauses stepping when frames go unconsumed (backpressure)', () => {
    const core = createSimCore(boardOption('uno').make());
    let consumed = 0;
    for (let i = 0; i < 100; i++) {
      if (consumed < 3) {
        core.step(16);
        consumed += 1;
      }
    }
    expect(core.timeMs).toBeLessThanOrEqual(3 * 40 + 16);
  });

  it('flashes words onto an AVR core without disturbing bench state', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
      } as never,
      'interpreter',
    );
    core.step(16);
    const before = core.timeMs;
    expect(before).toBeGreaterThan(0);
    // RJMP -1: an endless self-loop, so stepping the flashed program can
    // neither fault nor run off the end of flash.
    expect(() => core.flash(new Uint16Array([0xcfff]))).not.toThrow();
    expect(core.fault).toBeNull();
    core.step(16);
    // A rebuild would have zeroed the clock; flash must not.
    expect(core.timeMs).toBeGreaterThan(before);
    expect(core.fault).toBeNull();
    expect(() => core.snapshot()).not.toThrow();
  });

  it('ignores flash on non-Uno boards', () => {
    const core = createSimCore(boardOption('mega').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
      } as never,
      'interpreter',
    );
    expect(() => core.flash(new Uint16Array([0xcfff]))).not.toThrow();
    expect(core.fault).toBeNull();
  });
});

describe('tft snapshot transport', () => {
  const paintSketch = {
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [
      {
        name: 'main.ino',
        content: 'void setup() {\n  tft.fillRect(10, 20, 30, 40, 63488);\n}\nvoid loop() {}\n',
      },
    ],
  } as never;

  function tftBench(): never {
    return {
      parts: [
        { id: 'tft1', definition: ili9341Definition(), x: 0, y: 0, rotation: 0, terminals: {} },
      ],
      wires: [],
      terminals: [],
      revision: 0,
    } as never;
  }

  function blankMirror(): MirrorState {
    return { layout: null, pinVolts: new Map(), values: new Map(), colon: new Map(), serial: [] };
  }

  /** The shipped ESP32 panel circuit, where the panel is on the SPI bus. */
  function wiredTftBench() {
    const simulation = new Simulation(esp32DevKitV1());
    expect(simulation.loadCircuit(CIRCUITS['esp32-tft'])).toEqual([]);
    return simulation.bench;
  }

  it('round-trips painted panel pixels through writeTft, readFrame, and mirror decode', () => {
    const core = createSimCore(boardOption('esp32').make());
    core.rebuild(wiredTftBench(), paintSketch, 'interpreter');
    expect(core.fault).toBeNull();
    core.step(16);
    core.step(16);

    const frame = tftView(core.snapshot()).readFrame();
    // The document's panel is the 3.2" one: 480x320 of visible glass.
    expect(frame.width).toBe(480);
    expect(frame.height).toBe(320);
    expect(frame.rgb565).toHaveLength(480 * 320 * 2);

    const at = (x: number, y: number): number =>
      ((frame.rgb565[(y * frame.width + x) * 2] ?? 0) << 8) |
      (frame.rgb565[(y * frame.width + x) * 2 + 1] ?? 0);
    // Inside the painted rect, away from any text; and untouched black.
    expect(at(15, 25)).toBe(0xf800);
    expect(at(200, 200)).toBe(0);

    // Mirror decode: the rebuilt controller is pixel-identical.
    const panel = tftFromSnapshot(frame.width, frame.height, frame.rgb565);
    expect(panel?.pixelAt(15, 25)).toBe(0xf800);
    expect(panel?.pixelAt(200, 200)).toBe(0);

    // RGBA decode spot-checks the same two pixels.
    const rgba = tftRgbaFromFrame(frame.width, frame.height, frame.rgb565);
    expect(rgba).toHaveLength(480 * 320 * 4);
    const px = (x: number, y: number): number[] =>
      Array.from(rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));
    expect(px(15, 25)).toEqual([255, 0, 0, 255]);
    expect(px(200, 200)).toEqual([0, 0, 0, 255]);
  });

  it('paints nothing when the panel is not wired to the bus', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(tftBench(), paintSketch, 'interpreter');
    core.step(16);
    core.step(16);
    const frame = tftView(core.snapshot()).readFrame();
    expect(frame.width).toBe(320);
    expect(frame.height).toBe(240);
    expect(frame.rgb565.some((byte) => byte !== 0)).toBe(false);
  });

  it('reports an empty frame, with no mirror copy, when no TFT is on the bench', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
      } as never,
      'interpreter',
    );
    core.step(16);

    const buf = core.snapshot();
    const frame = tftView(buf).readFrame();
    expect(frame.width).toBe(0);
    expect(frame.height).toBe(0);
    expect(frame.rgb565).toHaveLength(0);

    const state = blankMirror();
    expect(ingestSnapshot(state, buf)).toBe('ok');
    expect(tftFromMirror(state)).toBeNull();
    expect(tftFromSnapshot(frame.width, frame.height, frame.rgb565)).toBeNull();
  });
});

describe('map sketch parity', () => {
  const TILE = 256;

  function syntheticRgba(width: number, height: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = (x * 5 + y * 3) % 256;
        data[i + 1] = (x * 7 + y * 11) % 256;
        data[i + 2] = (x * 13 + y * 17) % 256;
        data[i + 3] = 0xff;
      }
    }
    return data;
  }

  function installStubs(urls: string[]): void {
    const g = globalThis as unknown as Record<string, unknown>;
    g.fetch = async (url: unknown) => {
      urls.push(String(url));
      return { ok: true, blob: async () => new Blob([]) };
    };
    g.createImageBitmap = async () => ({ width: TILE, height: TILE, close() {} });
    g.OffscreenCanvas = class {
      readonly width: number;
      readonly height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): unknown {
        return {
          drawImage(): void {},
          getImageData(_x: number, _y: number, w: number, h: number): unknown {
            return { data: syntheticRgba(w, h) };
          },
        };
      }
    };
  }

  /*
   * Lets a promise callback run: microtask turns, no wall clock. The bridge and
   * the map both settle in microtasks, and inside one `tick`/`step` call a
   * sketch's poll loop cannot see an answer -- the collection is the next
   * frame's, which is what awaiting here stands in for.
   */
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('worker core draws the same map as in-page Simulation', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { fetch: g.fetch, cib: g.createImageBitmap, oc: g.OffscreenCanvas };
    const decoder = new TextDecoder();
    try {
      const exercise = exerciseById('5.1')!;
      const sketch = exercise.sketch as unknown as string;

      // Side A: in-page.
      const simUrls: string[] = [];
      installStubs(simUrls);
      const definition = boardOption('esp32').make();
      const sim = new Simulation(definition);
      sim.loadCircuit(exercise.circuit);
      sim.loadFirmware(sketch);
      sim.start();
      for (let i = 0; i < 400; i++) {
        sim.tick(0.05);
        await flush();
        if (sim.serialLines().join('').includes('map drawn')) break;
      }
      const simSerial = sim.serialLines().join('');
      const panel = [...sim.displayControllers().values()][0] as Ili9341;

      // Side B: worker core over the same bench and sketch.
      const coreUrls: string[] = [];
      installStubs(coreUrls);
      const core = createSimCore(boardOption('esp32').make());
      core.rebuild(
        sim.bench,
        {
          language: 'arduino-cpp',
          activeName: 'main.ino',
          files: [{ name: 'main.ino', content: sketch }],
        } as never,
        'interpreter',
      );
      expect(core.fault).toBeNull();
      let coreSerial = '';
      for (let i = 0; i < 400; i++) {
        core.step(40);
        const drained = serialRing(core.snapshot()).drain();
        if (drained.length > 0) coreSerial += decoder.decode(new Uint8Array(drained));
        await flush();
        if (coreSerial.includes('map drawn')) break;
      }

      // Identical verdicts: same tiles asked for, same serial tail, same panel.
      expect(simSerial).toContain('centred on tile');
      expect(simSerial).toContain('map drawn');
      expect(coreSerial).toBe(simSerial);
      expect(coreSerial.slice(-200)).toBe(simSerial.slice(-200));
      expect([...coreUrls].sort()).toEqual([...simUrls].sort());
      expect(coreUrls.length).toBeGreaterThan(0);

      const frame = tftView(core.snapshot()).readFrame();
      expect(frame.width).toBe(panel.width);
      expect(frame.height).toBe(panel.height);
      const expected = new Uint8Array(frame.width * frame.height * 2);
      let o = 0;
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const colour = panel.pixelAt(x, y);
          expected[o++] = colour >> 8;
          expected[o++] = colour & 0xff;
        }
      }
      expect(frame.rgb565).toEqual(expected);
    } finally {
      g.fetch = saved.fetch;
      g.createImageBitmap = saved.cib;
      g.OffscreenCanvas = saved.oc;
    }
  });

  /*
   * The bench network runs in whichever side owns the sketch, so both sides
   * have to answer identically. Unlike the map this needs no stubs at all:
   * the network is driven by simulated time rather than by the real network,
   * so the two runs agree exactly rather than approximately.
   */
  it('worker core answers the network the same way in-page Simulation does', async () => {
    const decoder = new TextDecoder();
    const sketch = `
void setup() {
  Serial.begin(115200);
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) { delay(20); }
  Serial.print("ip ");
  Serial.println(WiFi.localIP());
  while (net.get("http://api.noesis/time") == 0) { delay(20); }
  Serial.print("time ");
  Serial.println(net.read());
  while (net.get("http://nowhere.noesis/x") == 0) { delay(20); }
  if (net.failed()) { Serial.println("failed"); }
}

void loop() { delay(500); }
`;
    // Side A: in-page.
    const sim = new Simulation(esp32DevKitV1());
    sim.loadFirmware(sketch);
    sim.start();
    for (let i = 0; i < 200; i++) {
      sim.tick(0.05);
      if (sim.serialLines().join('').includes('failed')) break;
    }
    const simSerial = sim.serialLines().join('');

    // Side B: worker core, same sketch.
    const core = createSimCore(esp32DevKitV1());
    core.rebuild(
      sim.bench,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [{ name: 'main.ino', content: sketch }],
      } as never,
      'interpreter',
    );
    expect(core.fault).toBeNull();
    let coreSerial = '';
    for (let i = 0; i < 200; i++) {
      core.step(40);
      const drained = serialRing(core.snapshot()).drain();
      if (drained.length > 0) coreSerial += decoder.decode(new Uint8Array(drained));
      if (coreSerial.includes('failed')) break;
    }

    expect(simSerial).toContain('ip 192.168.4.10');
    expect(simSerial).toContain('failed');
    expect(coreSerial).toBe(simSerial);
  });

  /*
   * The bridge runs in whichever side owns the sketch too, and the fetcher is
   * the injected one there as well -- which is what makes this leg possible
   * without touching the real network: both sides are given the same stub and
   * have to ask it the same question.
   */
  it('bridges a live name identically in-page and in the worker', async () => {
    const decoder = new TextDecoder();
    const calls: string[] = [];
    const fetcher: NetFetcher = (url) => {
      calls.push(url);
      const answer: NetAnswer = { ok: true, body: '{"id":1,"title":"delectus aut autem"}' };
      return Promise.resolve(answer);
    };
    const sketch = `
void setup() {
  Serial.begin(115200);
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) { delay(20); }
  while (net.get("http://data.noesis/todos/1") == 0) { delay(20); }
  Serial.print("body ");
  Serial.println(net.read());
}

void loop() { delay(500); }
`;
    // Side A: in-page.
    const sim = new Simulation(esp32DevKitV1(), { liveNetwork: true, liveFetcher: fetcher });
    sim.loadFirmware(sketch);
    sim.start();
    for (let i = 0; i < 200; i++) {
      sim.tick(0.05);
      await flush();
      if (sim.serialLines().join('').includes('body')) break;
    }
    const simSerial = sim.serialLines().join('');

    // Side B: worker core, same sketch, same stub.
    const core = createSimCore(esp32DevKitV1(), undefined, {
      liveNetwork: true,
      liveFetcher: fetcher,
    });
    core.rebuild(
      sim.bench,
      {
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [{ name: 'main.ino', content: sketch }],
      } as never,
      'interpreter',
    );
    expect(core.fault).toBeNull();
    let coreSerial = '';
    for (let i = 0; i < 200; i++) {
      core.step(40);
      await flush();
      const drained = serialRing(core.snapshot()).drain();
      if (drained.length > 0) coreSerial += decoder.decode(new Uint8Array(drained));
      if (coreSerial.includes('body')) break;
    }

    expect(simSerial).toContain('body {"id":1,"title":"delectus aut autem"}');
    expect(coreSerial).toBe(simSerial);
    // Only the path and query travelled, and only to the mapped endpoint.
    expect(calls).toEqual([
      'https://jsonplaceholder.typicode.com/todos/1',
      'https://jsonplaceholder.typicode.com/todos/1',
    ]);
  });

  /*
   * The shipped default: a core built without the flag has no bridge at all, so
   * a live name is an unknown host. The stub is installed globally and must go
   * untouched -- that is the containment rule, asserted rather than assumed.
   */
  it('never reaches fetch when the bench did not opt in', () => {
    const spy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('nope') }),
    );
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    try {
      const core = createSimCore(esp32DevKitV1());
      core.rebuild(
        new Simulation(esp32DevKitV1()).bench,
        {
          language: 'arduino-cpp',
          activeName: 'main.ino',
          files: [
            {
              name: 'main.ino',
              content: `
void setup() {
  Serial.begin(115200);
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) { delay(20); }
  while (net.get("http://weather.noesis/v1/forecast") == 0) { delay(20); }
  if (net.failed()) { Serial.println("offline"); }
}

void loop() { delay(500); }
`,
            },
          ],
        } as never,
        'interpreter',
      );
      let serial = '';
      for (let i = 0; i < 200; i++) {
        core.step(40);
        const drained = serialRing(core.snapshot()).drain();
        if (drained.length > 0) serial += new TextDecoder().decode(new Uint8Array(drained));
        if (serial.includes('offline')) break;
      }
      expect(serial).toContain('offline');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
