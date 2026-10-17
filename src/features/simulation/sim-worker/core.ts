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

import { Engine } from '../engine';
import { McuRuntime } from '../mcu';
import { AvrBackend } from '../avr/core';
import { loadWasmModule } from '../avr/wasm-core';
import avrCoreWasmUrl from '../avr/wasm/avr-core.wasm?url';
import { hexForSourcesHash, parseIntelHex, sourcesHashForProject } from '../avr/hex';
import { Rp2040Backend } from '../rp2040/core';
import { fetchRp2040Assets, type Rp2040Assets } from '../rp2040/assets';
import { buildLittlefsImage } from '../rp2040/image';
import type { Rp2040Hooks } from '../rp2040/backend';
import { GROUND } from '../elements';
import { I2CBus } from '../bus/i2c';
import { SpiBus } from '../bus/spi';
import { BusLog } from '../bus/log';
import { FirmwareRunner, type FirmwareServices } from '../firmware/interpreter';
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
import { TILE_SIZE, TileStore } from '../map/map-tiles';
import {
  DISTANCE_KNOB,
  DynamicState,
  HUMIDITY_KNOB,
  Ili9341,
  LcdDriver,
  SevenSegment,
  TEMPERATURE_KNOB,
  echoMicroseconds,
  pixelCount,
} from '@/features/parts';
import type {
  DisplayController,
  KnobSpec,
  LcdCommand,
  PanelRotation,
  PartDefinition,
  Servo,
} from '@/features/parts';
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
    execution: 'interpreter' | 'avr' | 'rp2040',
    wasm?: boolean,
    fetchWasm?: () => Promise<ArrayBuffer>,
    fetchRp2040?: () => Promise<Rp2040Assets>,
  ): void;
  flash(words: Uint16Array): void;
  snapshot(): SharedArrayBuffer;
  readonly timeMs: number;
  readonly fault: string | null;
  readonly wasmAttached: boolean;
  readonly rp2040Attached: boolean;
}

export function createSimCore(
  board: PartDefinition,
  onNeedsRealloc?: (nodeCount: number, terminalCount: number) => void,
): CoreHandle {
  return new SimCore(board, onNeedsRealloc);
}

/** Display bytes a bench needs, with the same per-kind sizes `writeDisplay` uses. */
function displayBytesForBench(bench: Bench): number {
  let bytes = 0;
  for (const part of bench.parts) {
    const component = part.definition.component;
    if (component.kind === '7segment') bytes += (component.digits ?? 1) + 1;
    else if (component.kind === 'lcd') bytes += LCD_TEXT_BYTES + 1;
    else if (component.kind === 'servo') bytes += 1;
    else if (
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
  private readonly engine: Engine;
  private readonly onNeedsRealloc: ((nodeCount: number, terminalCount: number) => void) | undefined;
  private readonly busLog = new BusLog();
  private readonly spi: SpiBus;
  private readonly i2c: I2CBus;
  private readonly textEncoder = new TextEncoder();
  private bench: Bench;
  private runner: FirmwareRunner | null = null;
  private avrBackend: AvrBackend | null = null;
  private avrSettledRevision = -1;
  private wantWasm = false;
  private wasmDemoted = false;
  private wasmGeneration = 0;
  private wasmAttachedTo: AvrBackend | null = null;
  private wasmFetch: () => Promise<ArrayBuffer> = defaultFetchWasmBytes;
  private rp2040Backend: Rp2040Backend | null = null;
  /** Bumped by every rebuild; an attach whose generation is stale never lands. */
  private rp2040Generation = 0;
  private pendingDelayMs = 0;
  // Fault-cause contract: Wasm attach failures must set a `'wasm ...'`-prefixed
  // cause here without touching the interpreter runner (reserved: the
  // fallback-demote path is for transport failures only).
  private faultText: string | null = null;
  private serial: string[] = [];
  private serialCursor = 0;
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

  constructor(
    board: PartDefinition,
    onNeedsRealloc?: (nodeCount: number, terminalCount: number) => void,
  ) {
    this.controls = new DynamicState();
    this.mcu = new McuRuntime(board);
    this.bench = { parts: [], wires: [], terminals: [], revision: 0 };
    this.engine = new Engine({ bench: this.bench, mcu: this.mcu, dynamicState: this.controls });
    this.onNeedsRealloc = onNeedsRealloc;
    this.spi = new SpiBus((byte, dataSelect, chipSelected) => {
      this.engine.deliverSpi(byte, dataSelect, chipSelected);
      return true;
    });
    this.i2c = new I2CBus(
      (address, byte, isControl) => this.engine.writeI2C(address, byte, isControl),
      (address, count) => this.engine.requestI2C(address, count),
    );
  }

  get timeMs(): number {
    return this.engine.timeMs;
  }

  get fault(): string | null {
    return this.faultText;
  }

  /** Test seam: whether the live AVR backend has Wasm attached. */
  get wasmAttached(): boolean {
    return this.avrBackend !== null && this.wasmAttachedTo === this.avrBackend;
  }

  /** Test seam: whether the RP2040 backend finished attaching. */
  get rp2040Attached(): boolean {
    return this.rp2040Backend !== null;
  }

  rebuild(
    bench: Bench,
    firmware: FirmwareProject,
    execution: 'interpreter' | 'avr' | 'rp2040',
    wasm = false,
    fetchWasm: () => Promise<ArrayBuffer> = defaultFetchWasmBytes,
    fetchRp2040: () => Promise<Rp2040Assets> = fetchRp2040Assets,
  ): void {
    // Lab flag (rollout stage 1): when set, the module loads async and
    // attaches on arrival — the backend runs the JS path until then.
    this.wantWasm = wasm;
    this.wasmDemoted = false;
    this.wasmGeneration += 1;
    this.wasmAttachedTo = null;
    this.wasmFetch = fetchWasm;
    this.bench = bench;
    this.engine.timeMs = 0;
    this.mcu.reset();
    // A fresh sketch owes nothing: without this, the previous sketch's
    // in-flight delay would gate the new one, which reads as a hang.
    this.pendingDelayMs = 0;
    this.serial = [];
    this.serialCursor = 0;

    try {
      this.runner = new FirmwareRunner(firmware, this.services(), firmware.language);
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
    if (execution === 'avr') this.tryFlashAvr(firmware);
    if (execution === 'rp2040') void this.attachRp2040Async(firmware, this.rp2040Generation, fetchRp2040);
    this.engine.rebuild(bench, this.controls);
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
      // A delay still in flight blocks the firmware outright. Spending only
      // what fits in this frame and then resuming would let a 400 ms delay
      // complete in 400/frame-budget frames while the sketch carried on as
      // though it had waited -- turning a blink into a flicker.
      if (this.pendingDelayMs > 0) {
        const spend = Math.min(this.pendingDelayMs, frameEnd - this.engine.timeMs);
        this.pendingDelayMs -= spend;
        this.advanceBy(spend);
        continue;
      }

      if (!this.runner || this.runner.done) break;
      const requested = this.runner.step();
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
      } else if (component.kind === 'lcd') {
        const panel = this.engine.lcd(part.id);
        const bytes = this.textEncoder.encode(panel ? panel.text() : '');
        for (let i = 0; i < LCD_TEXT_BYTES; i++) put(bytes[i] ?? 0);
        put((panel?.lit ? 1 : 0) | (panel?.backlightOn ? 2 : 0));
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
    const panel = this.tft();
    if (!panel) {
      view.writeFrame(0, 0, new Uint8Array(0));
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
  flash(words: Uint16Array): void {
    try {
      if (this.mcu.board.id !== 'uno') return;
      this.flashAvrWords(words);
    } catch (error) {
      this.avrBackend = null;
      this.faultText = error instanceof Error ? error.message : String(error);
    }
  }

  /** Builds an AVR core from flash words over the same hooks `tryFlashAvr` uses. */
  private flashAvrWords(program: Uint16Array): void {
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
      i2c: this.avrI2cSink(),
    });
    this.avrBackend = flashed;
    if (this.wantWasm && !this.wasmDemoted) void this.attachWasmAsync(flashed, this.wasmGeneration, program);
  }

  /** Async attach: JS path until the module arrives; stale loads never land. */
  private async attachWasmAsync(backend: AvrBackend, generation: number, program: Uint16Array): Promise<void> {
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
    if (this.mcu.board.id !== 'rp2040') return;
    try {
      const assets = await fetcher();
      if (generation !== this.rp2040Generation) return;
      const image = await buildLittlefsImage(
        firmware.files,
        new Uint8Array(assets.littlefsWasm),
      );
      if (generation !== this.rp2040Generation) return;
      this.rp2040Backend = new Rp2040Backend(
        { uf2: new Uint8Array(assets.uf2), image },
        this.rp2040Hooks(),
      );
    } catch (error) {
      if (generation !== this.rp2040Generation) return;
      this.faultText = error instanceof Error ? error.message : String(error);
    }
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
    };
  }

  private avrI2cSink(): {
    writeByte(address: number, byte: number, isFirst: boolean): boolean;
    readByte(address: number, index: number): number;
    writeEnd(): void;
  } {
    return {
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

  /** The colour TFT on the bench, which is where a map goes. */
  private tft(): Ili9341 | undefined {
    for (const controller of this.displayControllers().values()) {
      if (controller instanceof Ili9341) return controller;
    }
    return undefined;
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
      tft: {
        setRotation: (rotation) => {
          const panel = this.tft();
          if (!panel) return 0;
          const target = Math.max(0, Math.min(3, Math.round(rotation))) as PanelRotation;
          panel.setRotation(target);
          return panel.rotation;
        },
        width: () => this.tft()?.width ?? 0,
        height: () => this.tft()?.height ?? 0,
        clear: () => {
          this.tft()?.clear();
          return 0;
        },
        fillRect: (x, y, width, height, colour) => {
          this.tft()?.fill(x, y, width, height, colour);
          return 0;
        },
        print: (text, x, y, colour) => {
          this.tft()?.print(text, x, y, colour);
          return 0;
        },
        textWidth: (text) => this.tft()?.textWidth(text) ?? 0,
        textHeight: () => this.tft()?.textHeight() ?? 0,
      },
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
          const panel = this.tft();
          if (!pixels || !panel) return false;
          panel.blit(destX, destY, pixels.length === 1 ? 1 : TILE_SIZE, TILE_SIZE, pixels);
          return true;
        },
        ready: () => this.tiles.complete && !this.fetcher.busy,
        reset: () => this.tiles.clearWanted(),
      },
      nowMs: () => this.engine.timeMs,
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
      wire: {
        begin: () => this.i2c.begin(0, 0),
        beginTransmission: (address) => this.i2c.beginTransmission(address),
        write: (value) => this.i2c.write(value),
        requestFrom: (address, count) => this.i2c.requestFrom(address, count),
        read: () => this.i2c.read(),
        available: () => this.i2c.available(),
        endTransmission: () => {
          const transfer = this.i2c.endTransmission();
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
      },
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
