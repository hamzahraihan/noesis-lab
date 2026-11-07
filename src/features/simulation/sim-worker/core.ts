/**
 * Worker-side simulation core: Engine + McuRuntime + both firmware backends
 * behind a plain factory, with no Worker globals anywhere in this file.
 *
 * The worker entry (a separate module) owns the message port, the pacing
 * timer, and the unread-frame bound; this module only hosts the simulation so
 * it stays importable in node for vitest.
 *
 * Construction order in `rebuild` mirrors `Simulation.loadFirmware` plus the
 * private `rebuild` there: clock reset, MCU reset, pending-delay clear,
 * interpreter runner construction (syntax faults land in `fault`), AVR flash
 * overlay by execution mode, then engine rebuild from the bench and a settle.
 * `step` mirrors `Simulation.tick`: the same 40 ms single-step clamp, the
 * same slice cap, interpreter delay spending across frames, the AVR branch
 * with its settle cadence, and the same circuit-only advance for unspent
 * budget. Only React/DOM concerns are left out.
 *
 * Two deliberate deviations from `Simulation`, both forced by the module
 * boundary rather than by choice:
 * - The tile store and fetcher live in `../map/` (moved there from the bench
 *   feature in Task 7 precisely so this import is in-feature): the map port
 *   below is wired exactly like `Simulation`'s `tiles`/`fetcher`/`map` port —
 *   same request/fetch/put/fail flow, same `blit` single-pixel exception, same
 *   `ready`/`reset`. Tile decode (`createImageBitmap` + `OffscreenCanvas`) is
 *   worker-safe.
 * - LCD line-to-board-pin resolution is derived per call from the current
 *   netlist (panel line net matched against board pin nets) instead of the
 *   remembered wiring map `Simulation` keeps while placing example parts.
 *   The strobe protocol on top (nibbles, enable edge, settle) is unchanged.
 *
 * Display region layout (for the main-thread mirror decoder): concatenated
 * per-part frames in `bench.parts` order, with per-kind frames:
 * - `7segment`: one pattern byte per digit (SEGMENT_ORDER bit order) plus one
 *   colon byte (0/1).
 * - `lcd`: 80 UTF-8 bytes of `panel.text()` zero-padded plus one flags byte
 *   (bit0 = glass lit, bit1 = backlight on).
 * - `servo`: one angle byte (0..180).
 * - `neopixel` / `neopixel-matrix` / `led-ring`: `pixelCount * 3` RGB bytes in
 *   DIN order.
 * `displayBytesForBench` below computes the region size with the same
 * per-kind constants the writer uses; keep the two in sync.
 *
 * The colour TFT is not in that per-part region: it travels as one frame in
 * the fixed-size `tft` sub-region (`tftView`): visible width/height plus
 * visible-order RGB565 bytes for the first Ili9341 on the bench (the same
 * first-match rule `tft()` uses for the sketch port), zeros when there is
 * none. The mirror decodes it to an `ImageData`/controller for the existing
 * canvas blit path.
 */

import { Engine, type I2cBusPins } from '../engine';
import { McuRuntime } from '../mcu';
import { AvrBackend } from '../avr/core';
import { loadWasmModule } from '../avr/wasm-core';
import avrCoreWasmUrl from '../avr/wasm/avr-core.wasm?url';
import { hexForSourcesHash, parseIntelHex, sourcesHashForProject } from '../avr/hex';
import { Rp2040Backend } from '../rp2040/core';
import { fetchRp2040Assets, type Rp2040Assets } from '../rp2040/assets';
import { buildLittlefsImage } from '../rp2040/image';
import type { Rp2040Hooks } from '../rp2040/backend';
import { Esp32Backend } from '../esp32/core';
import { fetchEsp32Assets, type Esp32Assets } from '../esp32/assets';
import { buildEsp32Filesystem } from '../esp32/image';
import type { Esp32Hooks } from '../esp32/backend';
import { GROUND } from '../elements';
import { loadScriptedRuntime } from '../scripted/load';
import { createScriptedI2c } from '../scripted/i2c';
import { createScriptedSampler } from '../scripted/sampler';
import { reportedFaults, type ScriptFault } from '../scripted/diagnostics';
import { I2CBus } from '../bus/i2c';
import { SpiBus } from '../bus/spi';
import { BusLog } from '../bus/log';
import {
  FirmwareRunner,
  describeFirmwareError,
  type FirmwareServices,
  type WirePort,
} from '../firmware/interpreter';
import { FirmwareDebugger, type Breakpoint, type DebugFrame } from '../firmware/debugger';
import type { CompiledDebugInfo } from '../avr/debug/lines';
import { pythonModulesFor } from '../firmware/python-modules';
import { FirmwareSyntaxError } from '../firmware/parser';
import {
  allocSnapshot,
  displayView,
  headerView,
  layoutFor,
  netView,
  pinNodeView,
  tftView,
  TFT_MAX_PIXELS,
  type DisplayView,
  type TftView,
} from './protocol';
import type { SnapshotLayout } from './protocol';
import { TileFetcher } from '../map/map-fetcher';
import { VirtualNetwork, createNetPort } from '../net/network';
import { TILE_SIZE, TileStore } from '../map/map-tiles';
import {
  DISTANCE_KNOB,
  DynamicState,
  HUMIDITY_KNOB,
  DS18B20_TEMPERATURE_KNOB,
  LcdDriver,
  MAX7219_FLAG_LIT,
  MAX7219_FRAME_BYTES,
  MAX7219_INTENSITY_SHIFT,
  Max7219,
  PCD8544_FLAG_INVERSE,
  PCD8544_FLAG_LIT,
  PCD8544_FLAGS_BYTES,
  PCD8544_FRAME_BYTES,
  Pcd8544,
  SSD1306_FLAG_LIT,
  SSD1306_FLAG_MIRRORED,
  SSD1306_FRAME_BYTES,
  SevenSegment,
  Ssd1306,
  Tm1637,
  TM1637_DIGITS,
  TM1637_FLAG_DUTY_SHIFT,
  TM1637_FLAG_LIT,
  TEMPERATURE_KNOB,
  echoMicroseconds,
  pixelCount,
} from '@/features/parts';
import type {
  DisplayController,
  Ili9341,
  KnobSpec,
  LcdCommand,
  PartDefinition,
  Servo,
} from '@/features/parts';
import { colorPanel, createTftPort, panelOnBus } from '../display/tft';
import { createLiveFetcher, type NetFetcher } from '../net/bridge';
import type { Bench, PartInstance } from '../bench';
import type { FirmwareProject } from '../firmware/project';

function defaultFetchWasmBytes(): Promise<ArrayBuffer> {
  return fetch(avrCoreWasmUrl).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
}

/** Longest slice of simulated time one `step` call may cover. */
const MAX_FRAME_MS = 40;
/** Upper bound on interpreter slices per step, so a runaway loop cannot hang. */
const MAX_SLICES_PER_FRAME = 400;
/** Serial chunks kept before the oldest fall off, as in `Simulation`. */
const SERIAL_CAP = 400;
/** Text bytes reserved per LCD frame; covers a 20x4 panel with margin. */
const LCD_TEXT_BYTES = 80;

export interface CoreInput {
  readonly kind: 'press' | 'knob';
  readonly partId: string;
  /**
   * Button state for `press`; for `knob` the spec travels inline with the
   * value (`{ spec, value }`) because the spec keys the stored setting and a
   * bare number cannot be routed without it.
   */
  readonly value: boolean | number | { readonly spec: KnobSpec; readonly value: number };
}

export interface CoreHandle {
  step(budgetMs: number): void;
  applyInput(op: CoreInput): void;
  rebuild(
    bench: Bench,
    firmware: FirmwareProject,
    execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32',
    wasm?: boolean,
    fetchWasm?: () => Promise<ArrayBuffer>,
    fetchRp2040?: () => Promise<Rp2040Assets>,
    fetchEsp32?: () => Promise<Esp32Assets>,
  ): void;
  flash(words: Uint16Array, debug?: CompiledDebugInfo): void;
  snapshot(): SharedArrayBuffer;
  readonly timeMs: number;
  readonly fault: string | null;
  /** Script faults latched in this realm, for the Problems panel. */
  faults(): readonly ScriptFault[];
  /**
   * The stops the debugger holds, set by the page.
   *
   * The stops are the page's to set and the worker's to keep: the sketch
   * runs here, so this is the only place that can hold the program still.
   */
  setStops(stops: readonly Breakpoint[]): void;
  /** The frame the program stopped on, while it is stopped. */
  debugFrame(): DebugFrame | null;
  /** Whether the debugger has the program stopped. */
  debugPaused(): boolean;
  /** Whether the run can be watched at its source lines. */
  debugWatchable(): boolean;
  /** Whether the running core is compiled firmware rather than the script. */
  debugCompiled(): boolean;
  /** Lets the program carry on from where it stopped. */
  resumeDebug(): void;
  /** Runs the program to the next statement, over a call or into it. */
  stepDebug(mode: 'over' | 'into'): void;
  /** Resolves once the scripted runtime is installed, for benches with scripts. */
  scriptedReady(): Promise<void>;
  readonly wasmAttached: boolean;
  readonly rp2040Attached: boolean;
  readonly esp32Attached: boolean;
}

/** What a core is built with beyond its board: the bench's live bridge. */
export interface CoreOptions {
  /** Whether this bench's network may bridge to real hosts (build data). */
  readonly liveNetwork?: boolean;
  /** Test seam: the fetcher a bridge uses instead of the browser's own. */
  readonly liveFetcher?: NetFetcher;
  /** Pre-created engine instance (e.g. WasmEngine). When provided, used
   *  instead of creating a new TS Engine. Issue #58. */
  readonly engine?: Engine;
}

export function createSimCore(
  board: PartDefinition,
  onNeedsRealloc?: (nodeCount: number, terminalCount: number) => void,
  options: CoreOptions = {},
): CoreHandle {
  return new SimCore(board, onNeedsRealloc, options);
}

/** Display bytes a bench needs, with the same per-kind sizes `writeDisplay` uses. */
function displayBytesForBench(bench: Bench): number {
  let bytes = 0;
  for (const part of bench.parts) {
    const component = part.definition.component;
    if (component.kind === '7segment') bytes += (component.digits ?? 1) + 1;
    else if (component.kind === 'tm1637') bytes += TM1637_DIGITS + 1;
    else if (component.kind === 'lcd') bytes += LCD_TEXT_BYTES + 1;
    else if (component.kind === 'servo') bytes += 1;
    else if (
      component.kind === 'display' &&
      (component.controller === 'ssd1306' || component.controller === 'ssd1306-spi')
    ) {
      // The panel's own memory, plus the byte that says whether the glass is
      // lit and whether the image is mirrored.
      bytes += SSD1306_FRAME_BYTES + 1;
    } else if (component.kind === 'display' && component.controller === 'max7219') {
      // One register per column, plus the flags that say whether the chip is
      // awake and how hard it is driving the LEDs.
      bytes += MAX7219_FRAME_BYTES + 1;
    } else if (component.kind === 'display' && component.controller === 'pcd8544') {
      // The panel's own memory, plus the flags that say whether the glass is
      // lit and inverted, plus the contrast voltage it was last driving.
      bytes += PCD8544_FRAME_BYTES + PCD8544_FLAGS_BYTES;
    } else if (
      component.kind === 'neopixel' ||
      component.kind === 'neopixel-matrix' ||
      component.kind === 'led-ring'
    ) {
      bytes += pixelCount(part.definition) * 3;
    }
  }
  return Math.max(bytes, 16);
}

class SimCore implements CoreHandle {
  private readonly controls: DynamicState;
  private readonly mcu: McuRuntime;
  private engine: Engine;
  private readonly onNeedsRealloc: ((nodeCount: number, terminalCount: number) => void) | undefined;
  private readonly busLog = new BusLog();
  private readonly spi: SpiBus;
  private readonly i2c: I2CBus;
  private readonly textEncoder = new TextEncoder();
  private bench: Bench;
  private runner: FirmwareRunner | null = null;
  /**
   * The debugger watching the sketch this realm runs.
   *
   * The page sets the stops and the worker holds them, because the program
   * runs here: a stop the page kept would be a stop nothing could honour.
   */
  private debugger: FirmwareDebugger | null = null;
  private avrBackend: AvrBackend | null = null;
  private executionMode: 'interpreter' | 'avr' | 'rp2040' | 'esp32' = 'interpreter';
  private avrSettledRevision = -1;
  private wantWasm = false;
  private wasmDemoted = false;
  private wasmGeneration = 0;
  private wasmAttachedTo: AvrBackend | null = null;
  private wasmFetch: () => Promise<ArrayBuffer> = defaultFetchWasmBytes;
  private rp2040Backend: Rp2040Backend | null = null;
  /**
   * True from an rp2040 rebuild until its machine has attached (or failed).
   *
   * The engine needs fetched artifacts, so the boot is asynchronous. Nothing
   * else may run in the meantime: stepping the interpreter would be a second
   * program on the same bench, and its output would vanish the moment the
   * machine attached.
   */
  private rp2040Pending = false;
  /** Bumped by every rebuild; an attach whose generation is stale never lands. */
  private rp2040Generation = 0;
  private esp32Backend: Esp32Backend | null = null;
  /**
   * True from an esp32 rebuild until its chip has booted (or failed).
   *
   * The emulated chip needs its artefacts fetched and its filesystem built
   * before it can run, and nothing else may run in the meantime for the same
   * reason the RP2 path gives.
   */
  private esp32Pending = false;
  /** Bumped by every rebuild; an attach whose generation is stale never lands. */
  private esp32Generation = 0;
  private pendingDelayMs = 0;
  // Fault-cause contract: Wasm attach failures must set a `'wasm ...'`-prefixed
  // cause here without touching the interpreter runner (reserved: the
  // fallback-demote path is for transport failures only).
  private faultText: string | null = null;
  private serial: string[] = [];
  private serialCursor = 0;
  /**
   * The last frame pulled out of the bench's colour panel, so a snapshot of an
   * unchanged panel re-sends bytes instead of walking every pixel again.
   */
  private tftCache: {
    panel: Ili9341;
    revision: number;
    width: number;
    height: number;
    rgb565: Uint8Array;
  } | null = null;
  private shm: SharedArrayBuffer | null = null;
  private layout: SnapshotLayout | null = null;
  private lcdDriver: LcdDriver | null = null;
  private sonarArmed: string | null = null;
  /**
   * The map port a sketch talks to: the host standing in for the radio, kept
   * exactly like `Simulation`'s `tiles`/`fetcher` pair (same store, same
   * fetcher, same put/fail flow) now the modules live in-feature in `../map/`.
   */
  private readonly tiles = new TileStore();
  private readonly fetcher = new TileFetcher();
  /*
   * The bench's network, on the same simulated clock the sketch is. Built from
   * the shared adapter rather than wired by hand: a port implemented twice is a
   * port that drifts, which is why the type and the adapter both live in
   * `../net/`.
   */
  private readonly net: VirtualNetwork;

  /** The fetcher this core's bridge uses, if any (a test's, or the browser's). */
  readonly liveFetcher: NetFetcher | null;

  constructor(
    board: PartDefinition,
    onNeedsRealloc?: (nodeCount: number, terminalCount: number) => void,
    options: CoreOptions = {},
  ) {
    this.controls = new DynamicState();
    this.mcu = new McuRuntime(board);
    this.bench = { parts: [], wires: [], terminals: [], revision: 0 };
    if (options.engine) {
      this.engine = options.engine;
    } else {
      this.engine = new Engine({ bench: this.bench, mcu: this.mcu, dynamicState: this.controls });
    }
    this.onNeedsRealloc = onNeedsRealloc;
    // Same rule as the in-page bench: a bridge exists only when the build said
    // so, and the fetcher is the worker's own `fetch` on this origin.
    this.liveFetcher = options.liveFetcher ?? null;
    this.net = new VirtualNetwork(() => this.engine.timeMs, {
      fetch: options.liveFetcher ?? (options.liveNetwork ? createLiveFetcher() : undefined),
    });
    this.spi = new SpiBus(
      (byte, dataSelect, chipSelected) => this.engine.deliverSpi(byte, dataSelect, chipSelected),
      () => this.engine.endSpiTransfer(),
    );
    this.i2c = new I2CBus(
      (address, byte, isControl) => this.engine.writeI2C(address, byte, isControl),
      (address, count) => this.engine.requestI2C(address, count),
    );
  }

  /**
   * The bus on a named pair of pins.
   *
   * A sketch that names a pair gets the bus on those pins, so a device wired
   * to another pair does not answer: the same silence a wire to the wrong hole
   * gives.
   */
  private pinnedI2c(pins: I2cBusPins): I2CBus {
    return new I2CBus(
      (address, byte, isControl) => this.engine.writeI2C(address, byte, isControl, pins),
      (address, count) => this.engine.requestI2C(address, count, pins),
    );
  }

  /**
   * The firmware's view of an I2C bus: the bench's bus, timed and logged.
   */
  private i2cPort(bus: I2CBus): WirePort {
    return {
      begin: () => bus.begin(0, 0),
      beginTransmission: (address) => bus.beginTransmission(address),
      write: (value) => bus.write(value),
      requestFrom: (address, count) => bus.requestFrom(address, count),
      read: () => bus.read(),
      available: () => bus.available(),
      endTransmission: () => {
        const transfer = bus.endTransmission();
        this.busLog.record({
          timeMs: this.engine.timeMs,
          bus: 'i2c',
          address: transfer.address,
          bytes: transfer.bytes,
          acknowledged: transfer.acknowledged,
          micros: transfer.micros,
        });
        this.engine.settle();
        return transfer.micros;
      },
    };
  }

  /**
   * The scripting half, loading the first time a scripted part exists.
   *
   * Lazy for the same reason as the in-page backend: 492 KB of QuickJS behind a
   * dynamic import, and a bench that never mentions a script must never fetch
   * it. Install ing the sampler rebuilds the netlist, so the first sample
   * replaces the safe zero a scripted part read until then.
   */
  private scriptedStart: Promise<void> | null = null;

  private ensureScriptedRuntime(): void {
    if (!this.bench.parts.some((part) => part.definition.script !== undefined)) return;
    this.scriptedStart ??= this.startScriptedRuntime();
  }

  private async startScriptedRuntime(): Promise<void> {
    const runtime = await loadScriptedRuntime();
    this.engine.setScriptedSampler(createScriptedSampler(runtime, () => this.bench.parts));
    this.engine.setScriptedI2c(createScriptedI2c(runtime, () => this.bench.parts));
  }

  get timeMs(): number {
    return this.engine.timeMs;
  }

  get fault(): string | null {
    return this.faultText;
  }

  faults(): readonly ScriptFault[] {
    return reportedFaults();
  }

  setStops(stops: readonly Breakpoint[]): void {
    const watcher = (this.debugger ??= new FirmwareDebugger());
    watcher.clear();
    for (const stop of stops) watcher.toggleBreakpoint(stop.file, stop.line);
    this.runner?.runtime.attachDebugger(watcher);
    this.avrBackend?.setDebugStops(watcher);
  }

  debugFrame(): DebugFrame | null {
    return this.avrBackend?.debugFrame() ?? this.runner?.stoppedAt ?? null;
  }

  debugPaused(): boolean {
    return this.avrBackend?.debugPaused() ?? this.runner?.paused === true;
  }

  /** A compiled core is watchable only when its build carried source rows. */
  debugWatchable(): boolean {
    if (this.avrBackend !== null) return this.avrBackend.hasDebugInfo;
    return this.executionMode === 'interpreter' || this.executionMode === 'avr';
  }

  /** An AVR core is present; RP2040/ESP32 and the fallback script are not. */
  debugCompiled(): boolean {
    return this.avrBackend !== null;
  }

  resumeDebug(): void {
    if (this.avrBackend?.hasDebugInfo) {
      this.avrBackend.resumeDebug();
      return;
    }
    this.runner?.resume();
  }

  stepDebug(mode: 'over' | 'into'): void {
    if (this.avrBackend?.hasDebugInfo) {
      this.avrBackend.stepDebug(mode);
      return;
    }
    const frame = this.debugFrame();
    if (mode === 'over') {
      if (frame === null) return;
      this.debugger?.stepOver(frame.depth);
    } else {
      this.debugger?.stepInto();
    }
    this.runner?.resume();
  }

  /** Resolves once the scripted runtime is installed (or immediately, if idle). */
  scriptedReady(): Promise<void> {
    this.ensureScriptedRuntime();
    return this.scriptedStart ?? Promise.resolve();
  }

  /** Test seam: whether the live AVR backend has Wasm attached. */
  get wasmAttached(): boolean {
    return this.avrBackend !== null && this.wasmAttachedTo === this.avrBackend;
  }

  /** Test seam: whether the RP2040 backend finished attaching. */
  get rp2040Attached(): boolean {
    return this.rp2040Backend !== null;
  }

  get esp32Attached(): boolean {
    return this.esp32Backend !== null;
  }

  rebuild(
    bench: Bench,
    firmware: FirmwareProject,
    execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32',
    wasm = false,
    fetchWasm: () => Promise<ArrayBuffer> = defaultFetchWasmBytes,
    fetchRp2040: () => Promise<Rp2040Assets> = fetchRp2040Assets,
    fetchEsp32: () => Promise<Esp32Assets> = fetchEsp32Assets,
  ): void {
    // Lab flag (rollout stage 1): when set, the module loads async and
    // attaches on arrival — the backend runs the JS path until then.
    this.wantWasm = wasm;
    this.wasmDemoted = false;
    this.wasmGeneration += 1;
    this.wasmAttachedTo = null;
    this.wasmFetch = fetchWasm;
    this.executionMode = execution;
    this.bench = bench;
    this.mcu.reset();
    // A fresh sketch owes nothing: without this, the previous sketch's
    // in-flight delay would gate the new one, which reads as a hang.
    this.pendingDelayMs = 0;
    this.serial = [];
    this.serialCursor = 0;

    this.engine = new Engine({ bench: this.bench, mcu: this.mcu, dynamicState: this.controls });
    this.engine.timeMs = 0;

    try {
      this.runner = new FirmwareRunner(firmware, this.services(), firmware.language);
      // The stops belong to the sketch, not to the run: a fresh runner is
      // still watched by the debugger the page set.
      this.runner.runtime.attachDebugger(this.debugger);
      this.faultText = null;
    } catch (error) {
      this.runner = null;
      this.faultText =
        error instanceof FirmwareSyntaxError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
    }
    // An AVR run needs a flashed core on top of the interpreter runner above;
    // anything missing falls back to that runner silently. The RP2040 engine
    // attaches asynchronously (assets must arrive first), so the interpreter
    // runs until it lands -- same contract as the Wasm attach.
    this.avrBackend = null;
    this.avrSettledRevision = -1;
    this.rp2040Backend = null;
    this.rp2040Generation += 1;
    this.rp2040Pending = execution === 'rp2040';
    this.esp32Backend = null;
    this.esp32Generation += 1;
    this.esp32Pending = execution === 'esp32';
    if (execution === 'avr') this.tryFlashAvr(firmware);
    if (execution === 'rp2040')
      void this.attachRp2040Async(firmware, this.rp2040Generation, fetchRp2040);
    if (execution === 'esp32')
      void this.attachEsp32Async(firmware, this.esp32Generation, fetchEsp32);
    this.engine.rebuild(bench, this.controls);
    this.ensureScriptedRuntime();
    this.engine.settle();
    this.ensureSnapshotBuffer();
  }

  step(budgetMs: number): void {
    const budget = Math.min(Math.max(budgetMs, 0), MAX_FRAME_MS);
    const frameEnd = this.engine.timeMs + budget;

    let slice = 0;
    while (this.engine.timeMs < frameEnd && slice++ < MAX_SLICES_PER_FRAME) {
      if (this.avrBackend) {
        this.avrBackend.step(Math.max(frameEnd - this.engine.timeMs, 0));
        this.engine.settle();
        if (this.avrBackend.fault) {
          if (this.wasmAttachedTo === this.avrBackend) {
            this.faultText = `wasm ${this.avrBackend.fault}`;
            this.wasmDemoted = true;
            this.wasmAttachedTo = null;
            this.avrBackend.attachWasm(null);
          } else {
            this.faultText = this.avrBackend.fault;
          }
          this.avrBackend = null;
        }
        this.advanceBy(frameEnd - this.engine.timeMs);
        return;
      }
      if (this.rp2040Backend) {
        this.rp2040Backend.step(Math.max(frameEnd - this.engine.timeMs, 0));
        this.engine.settle();
        if (this.rp2040Backend.fault) {
          this.faultText = this.rp2040Backend.fault;
          this.rp2040Backend = null;
        }
        this.advanceBy(frameEnd - this.engine.timeMs);
        return;
      }
      if (this.esp32Backend) {
        this.esp32Backend.step(Math.max(frameEnd - this.engine.timeMs, 0));
        this.engine.settle();
        if (this.esp32Backend.fault) {
          this.faultText = this.esp32Backend.fault;
          this.esp32Backend = null;
        }
        this.advanceBy(frameEnd - this.engine.timeMs);
        return;
      }
      /*
       * An rp2040 machine boots asynchronously (artifacts, then the image).
       * Until it lands nothing executes: time still advances, so Run, Reset and
       * the clock read the same way they will once the boot completes, but the
       * interpreter is not run as a stand-in for a mode that explicitly asked
       * for real firmware.
       */
      if (this.rp2040Pending) {
        this.advanceBy(frameEnd - this.engine.timeMs);
        return;
      }
      /*
       * The emulated ESP32 boots the same way: its artefacts arrive, its
       * filesystem is built, and only then does the chip run. Until it lands
       * nothing executes, for the same reason.
       */
      if (this.esp32Pending) {
        this.advanceBy(frameEnd - this.engine.timeMs);
        return;
      }
      // A delay still in flight blocks the firmware outright. When nothing in
      // the circuit can change (no PWM, no capacitors), skip the entire
      // remaining delay at once rather than parceling it out frame by frame --
      // that is the wait-for-interrupt optimization: a `delay(1000)` costs one
      // solve instead of twenty-five.
      if (this.pendingDelayMs > 0) {
        if (!this.engine.hasDynamics()) {
          this.engine.skip(this.pendingDelayMs / 1000);
          this.pendingDelayMs = 0;
          continue;
        }
        const spend = Math.min(this.pendingDelayMs, frameEnd - this.engine.timeMs);
        this.pendingDelayMs -= spend;
        this.advanceBy(spend);
        continue;
      }

      if (!this.runner || this.runner.done) break;
      let requested: number | null;
      try {
        requested = this.runner.step();
      } catch (error) {
        /*
         * A sketch that raised an error it did not catch stops here, and the
         * reason travels to the page as the bench's fault.
         */
        this.runner = null;
        this.faultText = describeFirmwareError(error);
        break;
      }
      if (requested === null) break;
      this.pendingDelayMs = requested;
      // One settle per step, not per pin write: a display refresh alone is a
      // dozen writes, and only this final state is ever observed.
      this.engine.settle();
    }

    // Whatever budget the firmware did not use still keeps the circuit
    // resolving, so a paused sketch shows a live, settled bench.
    this.advanceBy(frameEnd - this.engine.timeMs);
  }

  applyInput(op: CoreInput): void {
    if (op.kind === 'press') {
      this.controls.setPressed(op.partId, op.value === true || op.value === 1);
    } else {
      const value = op.value;
      if (typeof value === 'object' && value !== null) {
        this.controls.setKnob(op.partId, value.spec, value.value);
        this.engine.resampleScripted();
      }
    }
    this.engine.rebuild(this.bench, this.controls);
    this.engine.settle();
  }

  snapshot(): SharedArrayBuffer {
    this.ensureSnapshotBuffer();
    const buf = this.shm;
    if (!buf) throw new Error('sim core has no snapshot buffer');
    const netlist = this.engine.currentNetlist;

    const header = headerView(buf);
    const nets = netView(buf);
    for (let i = 0; i < nets.length; i++) {
      nets.write(i, i < netlist.nodeCount ? this.engine.voltageOfNet(i) : 0);
    }
    const pins = pinNodeView(buf);
    let p = 0;
    for (const net of netlist.pinNode.values()) {
      if (p >= pins.length) break;
      pins.write(p++, net);
    }
    for (; p < pins.length; p++) pins.write(p, 0);
    this.writeDisplay(displayView(buf));
    this.writeTft(tftView(buf));

    this.serialCursor = Math.min(this.serialCursor, this.serial.length);
    for (let i = this.serialCursor; i < this.serial.length; i++) {
      for (const byte of this.textEncoder.encode(this.serial[i])) header.serialPush(byte);
    }
    this.serialCursor = this.serial.length;

    header.timeMs = this.engine.timeMs;
    header.fault = this.faultText === null ? 0 : 1;
    header.bump();
    return buf;
  }

  /** Spends `ms` of simulated time on the circuit, without any firmware. */
  private advanceBy(ms: number): void {
    if (ms <= 0) return;

    // With no PWM and no capacitors the circuit cannot have changed, so a
    // one-second delay costs one solve rather than a thousand.
    if (!this.engine.hasDynamics()) {
      this.engine.skip(ms / 1000);
      return;
    }

    // Otherwise pace it: fine steps only while PWM or probes need them.
    const chunkMs = this.engine.needsFineSteps ? 2 : 40;
    const endTime = this.engine.timeMs + ms;
    let guard = 0;
    while (this.engine.timeMs < endTime && guard++ < 4000) {
      const remaining = endTime - this.engine.timeMs;
      this.engine.step(Math.min(remaining, chunkMs) / 1000);
    }
  }

  private ensureSnapshotBuffer(): void {
    const netlist = this.engine.currentNetlist;
    const needNodes = netlist.nodeCount;
    const needPins = netlist.pinNode.size;
    const needDisplay = displayBytesForBench(this.bench);
    const current = this.layout;
    if (
      this.shm &&
      current &&
      current.netFloats >= needNodes &&
      current.pinNodeUints >= needPins &&
      current.displayBytes >= needDisplay
    ) {
      return;
    }
    this.layout = layoutFor(needNodes, needPins, needDisplay);
    this.shm = allocSnapshot(this.layout);
    this.onNeedsRealloc?.(needNodes, needPins);
  }

  private writeDisplay(view: DisplayView): void {
    let o = 0;
    const put = (byte: number): void => {
      if (o < view.length) view.write(o++, byte & 0xff);
    };
    for (const part of this.bench.parts) {
      const component = part.definition.component;
      if (component.kind === '7segment') {
        const digits = component.digits ?? 1;
        const controller = this.engine.displayController(part.id);
        const seven = controller instanceof SevenSegment ? controller : null;
        const patterns = seven?.patterns() ?? new Uint8Array(0);
        for (let d = 0; d < digits; d++) put(patterns[d] ?? 0);
        put(seven?.colonLit ? 1 : 0);
      } else if (component.kind === 'tm1637') {
        const controller = this.engine.displayController(part.id);
        const display = controller instanceof Tm1637 ? controller : null;
        const patterns = display?.digits ?? [];
        for (let d = 0; d < TM1637_DIGITS; d++) put(patterns[d] ?? 0);
        put(
          (display?.lit ? TM1637_FLAG_LIT : 0) |
            ((display?.brightness ?? 0) << TM1637_FLAG_DUTY_SHIFT),
        );
      } else if (component.kind === 'lcd') {
        const panel = this.engine.lcd(part.id);
        const bytes = this.textEncoder.encode(panel ? panel.text() : '');
        for (let i = 0; i < LCD_TEXT_BYTES; i++) put(bytes[i] ?? 0);
        put((panel?.lit ? 1 : 0) | (panel?.backlightOn ? 2 : 0));
      } else if (
        component.kind === 'display' &&
        (component.controller === 'ssd1306' || component.controller === 'ssd1306-spi')
      ) {
        const controller = this.engine.displayController(part.id);
        const panel = controller instanceof Ssd1306 ? controller : null;
        // Ungated on purpose, like the colour panel: the mirror shows the
        // panel that is on the bench, even one whose jumpers are pulled.
        const frame = panel ? panel.frame() : new Uint8Array(0);
        for (let i = 0; i < SSD1306_FRAME_BYTES; i++) put(frame[i] ?? 0);
        put((panel?.lit ? SSD1306_FLAG_LIT : 0) | (panel?.mirrored ? SSD1306_FLAG_MIRRORED : 0));
      } else if (component.kind === 'display' && component.controller === 'max7219') {
        const controller = this.engine.displayController(part.id);
        const matrix = controller instanceof Max7219 ? controller : null;
        const frame = matrix ? matrix.frame() : new Uint8Array(0);
        for (let i = 0; i < MAX7219_FRAME_BYTES; i++) put(frame[i] ?? 0);
        const intensity = Math.round((matrix?.brightness ?? 0) * 0x0f);
        put((matrix?.lit ? MAX7219_FLAG_LIT : 0) | (intensity << MAX7219_INTENSITY_SHIFT));
      } else if (component.kind === 'display' && component.controller === 'pcd8544') {
        const controller = this.engine.displayController(part.id);
        const panel = controller instanceof Pcd8544 ? controller : null;
        const frame = panel ? panel.frame() : new Uint8Array(0);
        for (let i = 0; i < PCD8544_FRAME_BYTES; i++) put(frame[i] ?? 0);
        put((panel?.lit ? PCD8544_FLAG_LIT : 0) | (panel?.inverted ? PCD8544_FLAG_INVERSE : 0));
        // The contrast voltage the chip was last driving, 0 at its dimmest.
        put(Math.round((panel?.brightness ?? 0) * 0x7f));
      } else if (component.kind === 'servo') {
        const servo = this.engine.servo(part.id);
        put(servo ? Math.max(0, Math.min(180, Math.round(servo.angle))) : 0);
      } else if (
        component.kind === 'neopixel' ||
        component.kind === 'neopixel-matrix' ||
        component.kind === 'led-ring'
      ) {
        const count = pixelCount(part.definition);
        const colors = this.engine.pixelColors(part.id);
        for (let i = 0; i < count; i++) {
          const color = colors[i];
          put(color ? color.r : 0);
          put(color ? color.g : 0);
          put(color ? color.b : 0);
        }
      }
    }
    while (o < view.length) view.write(o++, 0);
  }

  /**
   * Captures the colour TFT into the fixed `tft` sub-region: visible
   * width/height plus visible-order RGB565 bytes (the same reading order
   * `Ili9341.toRgba` hands the canvas, so rotation is already applied).
   * Zeros when no TFT is on the bench, which is how the mirror tells "no
   * panel" from "a panel showing black".
   */
  private writeTft(view: TftView): void {
    // Ungated on purpose: the mirror shows the panel that is on the bench,
    // even one whose jumpers are pulled, because that is what the operator is
    // looking at. The gate lives in the port, not in the glass.
    const panel = colorPanel(this.displayControllers())?.panel;
    if (!panel) {
      this.tftCache = null;
      view.writeFrame(0, 0, new Uint8Array(0));
      return;
    }
    /*
     * Snapshots come once per painted frame, and a panel nothing has drawn to
     * should not be walked again: the controller counts its own changes, and a
     * match re-sends the bytes it already has. A fresh panel instance always
     * misses, so a rebuilt controller can never be served a stale frame.
     */
    const cached = this.tftCache;
    if (cached && cached.panel === panel && cached.revision === panel.frameRevision) {
      view.writeFrame(cached.width, cached.height, cached.rgb565);
      return;
    }
    const width = Math.max(0, Math.floor(panel.width));
    const height = Math.max(0, Math.floor(panel.height));
    const count = Math.max(0, Math.min(width * height, TFT_MAX_PIXELS));
    const rgb565 = new Uint8Array(count * 2);
    let o = 0;
    for (let y = 0; y < height && o < rgb565.length; y++) {
      for (let x = 0; x < width && o < rgb565.length; x++) {
        const colour = panel.pixelAt(x, y);
        rgb565[o++] = colour >> 8;
        rgb565[o++] = colour & 0xff;
      }
    }
    this.tftCache = { panel, revision: panel.frameRevision, width, height, rgb565 };
    view.writeFrame(width, height, rgb565);
  }

  /**
   * Flashes the committed HEX matching the loaded project onto an AVR core.
   *
   * Gated twice: only a Uno board can run it, and only a HEX whose staged
   * sources hash to this exact project applies.
   */
  private tryFlashAvr(project: FirmwareProject): void {
    try {
      if (this.mcu.board.id !== 'uno') return;
      const hexText = hexForSourcesHash(sourcesHashForProject(project));
      if (hexText === null) return;
      this.flashAvrWords(parseIntelHex(hexText));
    } catch (error) {
      this.avrBackend = null;
      this.faultText = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Flashes the given words onto an AVR core, establishing the same backend
   * `rebuild` builds for a committed HEX but without touching bench, firmware
   * runner, serial, or clock state. Construction failures clear the backend
   * and report through `fault`, as in `tryFlashAvr`.
   */
  flash(words: Uint16Array, debug?: CompiledDebugInfo): void {
    try {
      if (this.mcu.board.id !== 'uno') return;
      this.flashAvrWords(words, debug);
    } catch (error) {
      this.avrBackend = null;
      this.faultText = error instanceof Error ? error.message : String(error);
    }
  }

  /** Builds an AVR core from flash words over the same hooks `tryFlashAvr` uses. */
  private flashAvrWords(program: Uint16Array, debug?: CompiledDebugInfo): void {
    const flashed = new AvrBackend(program, {
      mcu: this.mcu,
      nowMs: () => this.engine.timeMs,
      onEdge: (gpio, cycles, high) => this.engine.recordGpioEdge(gpio, cycles, high),
      readPin: (gpio) => {
        // PIN reads observe the last scheduled solve except after a pin-intent
        // change (pinMode, reset): the cached solve predates the new intents,
        // so the first read after the change settles once.
        if (this.mcu.revision !== this.avrSettledRevision) {
          this.engine.settle();
          this.avrSettledRevision = this.mcu.revision;
        }
        return this.engine.readDigital(gpio);
      },
      // The Timer1 per-tick sampler observes without settling (see timer1.ts):
      // sampling the settling reader above per instruction settles once per
      // pin-intent revision instead of coalescing between firmware reads.
      readPinRaw: (gpio) => this.engine.readDigital(gpio),
      onSettle: () => this.engine.settle(),
      isProbed: () => this.engine.isBeingProbed,
      serial: { serialWrite: (text) => this.pushSerial(text) },
      i2c: this.i2cSink(),
    });
    flashed.attachDebug(debug ?? null);
    flashed.setDebugStops(this.debugger);
    this.avrBackend = flashed;
    if (this.wantWasm && !this.wasmDemoted)
      void this.attachWasmAsync(flashed, this.wasmGeneration, program);
  }

  /** Async attach: JS path until the module arrives; stale loads never land. */
  private async attachWasmAsync(
    backend: AvrBackend,
    generation: number,
    program: Uint16Array,
  ): Promise<void> {
    const loaded = await loadWasmModule(this.wasmFetch);
    if (generation !== this.wasmGeneration || this.avrBackend !== backend) return;
    if (!loaded.ok) {
      this.faultText = loaded.cause;
      return;
    }
    try {
      loaded.module.flashWords(program);
      // attachWasm still declares the legacy WasmCore shape while the driver
      // runs the AttachedWasm shape (cast lives inside runAttachedSlice); the
      // parameter-level cast keeps this seam from widening.
      backend.attachWasm(loaded.module.core as unknown as Parameters<AvrBackend['attachWasm']>[0]);
      backend.attachWasmReset(() => loaded.module.reset());
    } catch (error) {
      if (generation !== this.wasmGeneration || this.avrBackend !== backend) return;
      this.faultText = `wasm attach failed: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (generation !== this.wasmGeneration || this.avrBackend !== backend) return;
    if (this.faultText?.startsWith('wasm ') ?? false) this.faultText = null;
    this.wasmAttachedTo = backend;
  }

  /**
   * Async attach for `execution === 'rp2040'`: fetch the pinned artifacts,
   * mount the project's files as a LittleFS image, and seat the engine. Gated
   * twice like `tryFlashAvr`: only the Nano RP2040 Connect's board spec can
   * run it, and only if the generation is still current when each await
   * returns. Anything thrown lands in `fault`, labeled by `image.ts`.
   */
  private async attachRp2040Async(
    firmware: FirmwareProject,
    generation: number,
    fetcher: () => Promise<Rp2040Assets>,
  ): Promise<void> {
    if (this.mcu.board.id !== 'rp2040' && this.mcu.board.id !== 'pico') return;
    try {
      const assets = await fetcher();
      if (generation !== this.rp2040Generation) return;
      const image = await buildLittlefsImage(firmware.files, new Uint8Array(assets.littlefsWasm));
      if (generation !== this.rp2040Generation) return;
      this.rp2040Backend = new Rp2040Backend(
        { uf2: new Uint8Array(assets.uf2), image },
        this.rp2040Hooks(),
      );
      this.rp2040Pending = false;
    } catch (error) {
      if (generation !== this.rp2040Generation) return;
      this.rp2040Pending = false;
      this.faultText = error instanceof Error ? error.message : String(error);
      // An explicit RP2040 mode does not silently fall back to the
      // interpreter: the mode asked for the pinned firmware, and a Python
      // front end that happens to accept the files is a different engine.
      this.runner = null;
    }
  }

  /**
   * Async attach for `execution === 'esp32'`: fetch the pinned artefacts,
   * build the filesystem the chip mounts, and seat the emulated chip. Gated
   * twice like `tryFlashAvr`: only the ESP32's board spec can run it, and
   * only if the generation is still current when each await returns. Anything
   * thrown lands in `fault`.
   */
  private async attachEsp32Async(
    firmware: FirmwareProject,
    generation: number,
    fetcher: () => Promise<Esp32Assets>,
  ): Promise<void> {
    if (this.mcu.board.id !== 'esp32') return;
    try {
      const assets = await fetcher();
      if (generation !== this.esp32Generation) return;
      const filesystem = await buildEsp32Filesystem(
        firmware.files,
        new Uint8Array(assets.littlefsWasm),
      );
      if (generation !== this.esp32Generation) return;
      const backend = new Esp32Backend(
        {
          wasm: assets.wasm,
          rom: assets.rom,
          image: assets.image,
          filesystem,
        },
        this.esp32Hooks(),
      );
      await backend.start();
      if (generation !== this.esp32Generation) return;
      if (backend.fault) {
        this.faultText = backend.fault;
        this.esp32Pending = false;
        this.runner = null;
        return;
      }
      this.esp32Backend = backend;
      this.esp32Pending = false;
    } catch (error) {
      if (generation !== this.esp32Generation) return;
      this.esp32Pending = false;
      this.faultText = error instanceof Error ? error.message : String(error);
      // An explicit ESP32 mode does not silently fall back to the
      // interpreter: the mode asked for the real chip, and a Python front end
      // that happens to accept the files is a different engine.
      this.runner = null;
    }
  }

  /**
   * The emulated chip's engine hooks.
   *
   * The chip speaks its own GPIO numbering, and the ESP32's header holes carry
   * the chip's numbers (D2 is GPIO2, VP is GPIO36), so a pin crosses this
   * boundary under its own name -- there is no map to keep in step.
   */
  private esp32Hooks(): Esp32Hooks {
    return {
      mcu: this.mcu,
      nowMs: () => this.engine.timeMs,
      onEdge: (gpio, cycles, high) => this.engine.recordGpioEdge(gpio, cycles, high),
      readPin: (gpio) => this.engine.readDigital(gpio),
      onSettle: () => this.engine.settle(),
      serial: { serialWrite: (text) => this.pushSerial(text) },
      // The chip's I2C controller talks to the bench's bus through the same
      // sink the RP2040's bridge uses: the engine decides who is on the bus
      // and the bus log sees the transfer either way.
      i2c: this.i2cSink(),
      // The chip's SPI master shifts bytes out of the same bus, and the
      // D/C and chip-select lines the bench's displays need are the chip's
      // own GPIOs, so the sink carries their level with every byte.
      spi: this.spiSink(),
    };
  }

  /** Engine hooks: same shape the AVR backend gets, minus the AVR-only ports. */
  private rp2040Hooks(): Rp2040Hooks {
    return {
      mcu: this.mcu,
      nowMs: () => this.engine.timeMs,
      onEdge: (gpio, cycles, high) => this.engine.recordGpioEdge(gpio, cycles, high),
      // Reads happen inside the engine's settle cadence, right after
      // `onSettle`, so the solve is always fresh here -- no revision dance.
      readPin: (gpio) => this.engine.readDigital(gpio),
      onSettle: () => this.engine.settle(),
      serial: { serialWrite: (text) => this.pushSerial(text) },
      i2c: this.i2cSink(),
    };
  }

  /**
   * The machine backends' I2C sink: each byte goes to the engine (which
   * decides the ACK and moves device state) and is staged through the shared
   * `I2CBus` so the closing `writeEnd` records the transfer in the bus log.
   * Reads stay engine-direct.
   */
  private i2cSink(): {
    hasDevice(address: number): boolean;
    writeByte(address: number, byte: number, isFirst: boolean): boolean;
    readByte(address: number, index: number): number;
    writeEnd(): void;
  } {
    return {
      hasDevice: (address) => this.engine.hasI2cDevice(address),
      writeByte: (address, byte, isFirst) => {
        if (isFirst) this.i2c.beginTransmission(address);
        this.i2c.write(byte);
        return this.engine.writeI2C(address, byte, isFirst);
      },
      readByte: (address, index) => this.engine.requestI2C(address, index + 1)[index] ?? 0xff,
      writeEnd: () => {
        const transfer = this.i2c.endTransmission();
        this.busLog.record({
          timeMs: this.engine.timeMs,
          bus: 'i2c',
          address: transfer.address,
          bytes: transfer.bytes,
          acknowledged: transfer.acknowledged,
          micros: transfer.micros,
        });
      },
    };
  }

  /**
   * The bench's SPI bus, as the emulated chip's master sees it.
   *
   * The chip shifts bytes out and reads MISO back, so every byte goes to the
   * bus with the level of the D/C line the sketch is driving, and the bus
   * answers with the byte the device would have shifted in.
   */
  private spiSink(): {
    begin(): void;
    transfer(byte: number, dataSelect: boolean, chipSelected: boolean): number;
    end(): void;
  } {
    return {
      begin: () => this.spi.begin(),
      transfer: (byte, dataSelect, chipSelected) =>
        this.spi.transfer(byte, dataSelect, chipSelected),
      end: () => {
        const transfer = this.spi.end();
        this.busLog.record({
          timeMs: this.engine.timeMs,
          bus: 'spi',
          address: null,
          bytes: transfer.bytes.map((byte) => byte.value),
          acknowledged: transfer.acknowledged,
          micros: transfer.micros,
        });
      },
    };
  }

  /** Appends serial text through the shared 400-entry cap. */
  private pushSerial(text: string): void {
    this.serial.push(text);
    if (this.serial.length > SERIAL_CAP) {
      const dropped = this.serial.length - SERIAL_CAP;
      this.serial.splice(0, dropped);
      this.serialCursor = Math.max(0, this.serialCursor - dropped);
    }
  }

  /** The servo whose signal pin is wired to a board pin, if there is one. */
  private servoOnPin(pin: number): Servo | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      const servo = this.engine.servo(part.id);
      if (servo && this.engine.currentNetlist.pinNode.get(`${part.id}:PWM`) === net) return servo;
    }
    return null;
  }

  /** The sonar whose echo pin is wired to a board pin, if there is one. */
  private sonarOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'sonar') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:ECHO`) === net) return part;
    }
    return null;
  }

  /**
   * The display module whose clock and data lines are wired to two board
   * pins, if there is one.
   *
   * Both lines have to land: the module has no address and no way to say
   * which of two on the bus it is, so it is found by the pair the sketch
   * named.
   */
  private tm1637OnPins(clk: number, dio: number): Tm1637 | null {
    const clkId = this.mcu.pinIdForGpio(clk);
    const dioId = this.mcu.pinIdForGpio(dio);
    if (clkId === undefined || dioId === undefined) return null;
    const clkNet = this.engine.netOfMcuPin(clkId);
    const dioNet = this.engine.netOfMcuPin(dioId);
    if (clkNet === GROUND || dioNet === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'tm1637') continue;
      const nodes = this.engine.currentNetlist.pinNode;
      if (nodes.get(`${part.id}:CLK`) !== clkNet) continue;
      if (nodes.get(`${part.id}:DIO`) !== dioNet) continue;
      const model = this.engine.displayController(part.id);
      return model instanceof Tm1637 ? model : null;
    }
    return null;
  }

  /** The DHT sensor whose data pin is wired to a board pin, if there is one. */
  private dhtOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'dht') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:SDA`) === net) return part;
    }
    return null;
  }

  /** The one-wire sensor whose data pin is wired to a board pin, if there is one. */
  private oneWireOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'ds18b20') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:DQ`) === net) return part;
    }
    return null;
  }

  /** The IR receiver whose data pin is wired to a board pin, if there is one. */
  private irReceiverOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'ir-receiver') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:DAT`) === net) return part;
    }
    return null;
  }

  /** The dialer whose dial line is wired to a board pin, if there is one. */
  private dialerOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'rotary-dialer') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:DIAL`) === net) return part;
    }
    return null;
  }

  /** The card whose chip-select line is wired to a board pin, if any. */
  private sdOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'microsd') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:CS`) === net) return part;
    }
    return null;
  }

  /** The pixel part whose data-in pin is wired to a board pin, if any. */
  private pixelsOnPin(pin: number): PartInstance | null {
    const pinId = this.mcu.pinIdForGpio(pin);
    if (pinId === undefined) return null;
    const net = this.engine.netOfMcuPin(pinId);
    if (net === GROUND) return null;
    for (const part of this.bench.parts) {
      const kind = part.definition.component.kind;
      if (kind !== 'neopixel' && kind !== 'neopixel-matrix' && kind !== 'led-ring') continue;
      if (this.engine.currentNetlist.pinNode.get(`${part.id}:DIN`) === net) return part;
    }
    return null;
  }

  /** The character LCD on the bench, backed by the first LCD part found. */
  private characterLcd(): LcdDriver | null {
    if (!this.lcdDriver) {
      for (const part of this.bench.parts) {
        const panel = this.engine.lcd(part.id);
        if (panel) this.lcdDriver = new LcdDriver(panel);
      }
    }
    return this.lcdDriver;
  }

  /**
   * The board pin number driving an LCD control line, resolved from the
   * current netlist: the line's net matched against board pin nets. -1 when
   * the line is not wired to any board pin, and every write to it is skipped,
   * which is how a display on the wrong header ends up dark.
   */
  private lcdLineGpio(partId: string, line: string): number {
    const net = this.engine.currentNetlist.pinNode.get(`${partId}:${line}`);
    if (net === undefined || net === GROUND) return -1;
    for (const pin of this.mcu.pins()) {
      if (pin.gpio === undefined) continue;
      if (this.engine.netOfMcuPin(pin.id) === net) return pin.gpio;
    }
    return -1;
  }

  private lcdPanelPartId(): string | null {
    for (const part of this.bench.parts) {
      if (this.engine.lcd(part.id)) return part.id;
    }
    return null;
  }

  private lcdGpios(): {
    rs: number;
    enable: number;
    data: readonly number[];
    all: readonly number[];
  } {
    const partId = this.lcdPanelPartId();
    if (partId === null) return { rs: -1, enable: -1, data: [], all: [] };
    // D4 first: the panel's bit 4 is on its D4, and the order here is the
    // order the host writes them in.
    const data = ['D4', 'D5', 'D6', 'D7', 'D0'].map((line) => this.lcdLineGpio(partId, line));
    const rs = this.lcdLineGpio(partId, 'RS');
    const enable = this.lcdLineGpio(partId, 'E');
    return { rs, enable, data, all: [rs, enable, ...data].filter((pin) => pin >= 0) };
  }

  /**
   * Puts one library operation on the wire, byte by byte.
   *
   * The handshake is the real one: the enable line is pulsed around each
   * nibble, and the engine reads those pins back, so a header that is not
   * wired stops the bytes arriving rather than only failing to look right.
   */
  private sendLcd(action: (lcd: LcdDriver) => readonly LcdCommand[]): number {
    const found = this.characterLcd();
    if (!found) return 0;
    // Each byte goes out as two strobed nibbles: the panel takes four bits at a
    // time and shifts the halves together on its own side.
    for (const command of action(found)) {
      const high = (command.value >> 4) & 0x0f;
      const low = command.value & 0x0f;
      this.strokeLcd(command.isData, high);
      this.strokeLcd(command.isData, low);
    }
    return 0;
  }

  /**
   * Claims the panel's control lines as outputs.
   *
   * A pin comes out of reset as a floating input, and a write to one is ignored
   * -- so the library has to configure its own pins, which is exactly what a
   * real `LiquidCrystal` constructor does with the six numbers it is handed.
   * Called once, at `begin`, rather than per byte.
   */
  private driveLcdPins(): void {
    for (const line of this.lcdGpios().all) {
      if (line >= 0) this.mcu.setDirection(line, 'output');
    }
  }

  /** One nibble onto the panel's data lines, with an enable strobe. */
  private strokeLcd(isData: boolean, value: number): void {
    const pins = this.lcdGpios();
    const level = (line: number, high: boolean) => {
      if (line >= 0) this.mcu.writeDigital(line, high, this.engine.timeMs);
    };
    level(pins.rs, isData);
    level(pins.data[0], ((value >> 4) & 1) === 1);
    level(pins.data[1], ((value >> 3) & 1) === 1);
    level(pins.data[2], ((value >> 2) & 1) === 1);
    level(pins.data[3], ((value >> 1) & 1) === 1);
    level(pins.data[4], (value & 1) === 1);
    if (pins.enable < 0) return;
    level(pins.enable, false);
    this.engine.primeLcdEdges();
    level(pins.enable, true);
    this.engine.settle();
  }

  /** Lights or dims the backlight through the same header as everything else. */
  private backlight(on: boolean): void {
    const panel = this.characterLcd()?.target;
    panel?.setBacklight(on);
    this.engine.settle();
  }

  /** Live controller models for every display part. */
  private displayControllers(): Map<string, DisplayController> {
    const controllers = new Map<string, DisplayController>();
    for (const part of this.bench.parts) {
      const controller = this.engine.displayController(part.id);
      if (controller) controllers.set(part.id, controller);
    }
    return controllers;
  }

  private services(): FirmwareServices {
    return {
      tft: createTftPort(this.engine, () => this.displayControllers()),
      // No tile store here anymore: it lives in `../map/` in-feature, so the
      // map port below is the real one, wired exactly like `Simulation`'s.
      map: {
        request: (z, x, y) => {
          const ready = this.tiles.request(z, x, y);
          if (!ready) {
            void this.fetcher.fetch({ z, x, y }).then((pixels) => {
              if (pixels) {
                this.tiles.put(z, x, y, pixels);
                return;
              }
              // Say so. Leaving it wanted meant the sketch polled for arrival
              // forever over a tile that was never coming, and a map with one hole
              // in it never drew at all -- fourteen good tiles held hostage by one
              // the server would not serve.
              this.tiles.fail(z, x, y);
            });
          }
          return ready;
        },
        blit: (z, x, y, destX, destY) => {
          const pixels = this.tiles.get(z, x, y);
          const panel = panelOnBus(this.engine, this.displayControllers());
          if (!pixels || !panel) return false;
          panel.blit(destX, destY, pixels.length === 1 ? 1 : TILE_SIZE, TILE_SIZE, pixels);
          return true;
        },
        ready: () => this.tiles.complete && !this.fetcher.busy,
        reset: () => this.tiles.clearWanted(),
      },
      net: createNetPort(this.net),
      nowMs: () => this.engine.timeMs,
      // The board's own pin namespace: on most boards a sketch's pin number is
      // the GPIO number, and on the Nano RP2040 Connect it is not.
      pins: this.mcu.arduinoPins,
      // The Python vocabulary this board's runtime speaks: `machine` on the
      // MicroPython boards, `gpiozero` on a Raspberry Pi.
      pythonModules: pythonModulesFor(this.mcu.board.id),
      pinMode: (pin, mode) => {
        // No settle here: pin writes only retarget future solves, and the
        // slice loop settles once per step below.
        this.mcu.setDirection(pin, mode === 0 ? 'input' : mode === 2 ? 'inputPullUp' : 'output');
      },
      digitalWrite: (pin, level) => {
        this.mcu.writeDigital(pin, level !== 0, this.engine.timeMs);
      },
      digitalRead: (pin) => {
        this.engine.settle();
        return this.engine.readDigital(pin) ? 1 : 0;
      },
      analogWrite: (pin, value) => {
        this.mcu.writeAnalog(pin, value, this.engine.timeMs);
      },
      analogRead: (pin) => {
        this.engine.settle();
        return this.engine.readAnalog(pin);
      },
      adcFullScale: this.engine.adcFullScale,
      wire: this.i2cPort(this.i2c),
      // The bus on the pins a sketch named, for a sketch that named them: a
      // device wired elsewhere is not on it, and does not answer.
      wireOnPins: (pins) => this.i2cPort(this.pinnedI2c(pins)),
      // Whether anything on the bench answers at this address: a MicroPython
      // sketch that reads a device nobody wired is told so, the way a
      // controller that was not acknowledged tells it.
      i2cHasDevice: (address, pins) => this.engine.hasI2cDevice(address, pins),
      spi: {
        begin: () => this.spi.begin(),
        transfer: (value, dataSelect) => this.spi.transfer(value, dataSelect),
        end: () => {
          const transfer = this.spi.end();
          this.busLog.record({
            timeMs: this.engine.timeMs,
            bus: 'spi',
            address: null,
            bytes: transfer.bytes.map((byte) => byte.value),
            acknowledged: transfer.acknowledged,
            micros: transfer.micros,
          });
          this.engine.settle();
          return transfer.micros;
        },
      },
      lcd: {
        begin: (columns, rows) => {
          if (!this.characterLcd()) return 0;
          this.driveLcdPins();
          return this.sendLcd((lcd) => lcd.begin(columns, rows));
        },
        clear: () => this.sendLcd((lcd) => lcd.clear()),
        home: () => this.sendLcd((lcd) => lcd.home()),
        setCursor: (column, row) => this.sendLcd((lcd) => lcd.setCursor(column, row)),
        print: (text) => this.sendLcd((lcd) => lcd.text(text)),
        write: (value) => this.sendLcd((lcd) => lcd.byte(value)),
        createChar: (slot, bitmap) => this.sendLcd((lcd) => lcd.createChar(slot, bitmap)),
        backlight: () => this.backlight(true),
        noBacklight: () => this.backlight(false),
      },
      servo: {
        attach: () => {},
        write: (pin, angle) => {
          const servo = this.servoOnPin(pin);
          if (!servo) return;
          servo.write(angle);
          // The servo load is stamped around the netlist: same nets, new
          // circuit, so the solve cache must not reuse the pre-write answer.
          this.engine.touch();
          this.engine.settle();
        },
        read: (pin) => this.servoOnPin(pin)?.angle ?? 0,
        detach: (pin) => this.servoOnPin(pin)?.detach(),
      },
      pulseInBegin: (pin, level, timeoutUs) => {
        // ECHO idles low and only HIGH pulses are synthesized, so asking
        // for a LOW pulse times out exactly as on hardware.
        if (level === 0) return 0;
        const sonar = this.sonarOnPin(pin);
        if (!sonar) return 0;
        const micros = echoMicroseconds(this.controls.knob(sonar.id, DISTANCE_KNOB));
        if (micros > timeoutUs) return 0;
        this.sonarArmed = sonar.id;
        this.engine.setSonarMeasuring(sonar.id, true);
        this.engine.settle();
        return micros;
      },
      pulseInEnd: () => {
        if (this.sonarArmed === null) return;
        this.engine.setSonarMeasuring(this.sonarArmed, false);
        this.sonarArmed = null;
        this.engine.settle();
      },
      dht: {
        begin: () => {},
        temperature: (pin) => {
          const part = this.dhtOnPin(pin);
          return part ? this.controls.knob(part.id, TEMPERATURE_KNOB) : 0;
        },
        humidity: (pin) => {
          const part = this.dhtOnPin(pin);
          return part ? this.controls.knob(part.id, HUMIDITY_KNOB) : 0;
        },
      },
      onewire: {
        temperature: (pin) => {
          const part = this.oneWireOnPin(pin);
          return part ? this.controls.knob(part.id, DS18B20_TEMPERATURE_KNOB) : 0;
        },
      },
      tm1637: {
        print: (clk, dio, text) => {
          this.tm1637OnPins(clk, dio)?.print(text);
        },
        printNumber: (clk, dio, value, places) => {
          this.tm1637OnPins(clk, dio)?.printNumber(value, places);
        },
        setBrightness: (clk, dio, level) => {
          this.tm1637OnPins(clk, dio)?.setBrightness(level);
        },
        write: (clk, dio, command, data) => {
          this.tm1637OnPins(clk, dio)?.transaction(command, data);
        },
      },
      ir: {
        readCode: (pin) => {
          const part = this.irReceiverOnPin(pin);
          return part ? this.engine.irCode() : 0;
        },
      },
      dialer: {
        read: (pin) => {
          const part = this.dialerOnPin(pin);
          return part ? this.engine.dialedDigit(part.id) : -1;
        },
      },
      sd: {
        begin: (pin) => (this.sdOnPin(pin) ? 1 : 0),
        write: (pin, name, text) => {
          const part = this.sdOnPin(pin);
          return part ? this.engine.sdWrite(part.id, name, text) : 0;
        },
        read: (pin, name) => {
          const part = this.sdOnPin(pin);
          return part ? this.engine.sdRead(part.id, name) : '';
        },
        exists: (pin, name) => {
          const part = this.sdOnPin(pin);
          return part ? this.engine.sdExists(part.id, name) : 0;
        },
        remove: (pin, name) => {
          const part = this.sdOnPin(pin);
          return part ? this.engine.sdRemove(part.id, name) : 0;
        },
      },
      pixels: {
        count: (pin) => {
          const part = this.pixelsOnPin(pin);
          return part ? pixelCount(part.definition) : 0;
        },
        setColor: (pin, index, r, g, b) => {
          const part = this.pixelsOnPin(pin);
          if (!part) return;
          this.engine.setPixel(part.id, index, { r, g, b });
          this.engine.settle();
        },
      },
      serialBegin: () => {},
      serialWrite: (text) => {
        this.pushSerial(text);
      },
    };
  }
}
