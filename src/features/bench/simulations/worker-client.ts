/**
 * Bench-side sim worker client: mirror, fallback, and UI seam (Task 4).
 *
 * The mirror is the main thread's copy of the worker's shared-memory frame.
 * Per rAF the owner calls `ingestSnapshot` with the live buffer: `'ok'` means
 * the copied `pinVolts`/`values`/`colon`/`serial` maps are the new frame,
 * `'stale'` means the generation did not advance (render the last copy, no
 * tearing), and `'reallocated'` means the buffer's layout differs — rebind to
 * the new layout and drop one frame, never reading across layouts.
 *
 * `ingestSnapshot` is pure and directly unit-testable: it tracks the last
 * generation per `MirrorState` (via a WeakMap, so the brief's `MirrorState`
 * shape stays verbatim) and compares layouts read back from the buffer alone
 * through the protocol views. Without the bench snapshot it cannot know
 * part ids, so it copies pin-slot voltages as `pin:<index>` plus the raw
 * display bytes as a single `raw` entry; `remapWithBench` (which holds the
 * last bench sent on structural edits) remaps those into `${partId}:${pinId}`
 * volts and per-part value arrays. Serial drains accumulate UTF-8-decoded
 * text (capped like `Simulation`); the ring's sticky overflow flag is held by
 * the client and exposed as `serialOverflow` alongside `status()`.
 *
 * Display adapters (`sevenSegmentFromSnapshot`, `lcdFromSnapshot`) rebuild
 * the real controller models the renderers read — latched 7-segment patterns
 * replayed through the public `update` path digit by digit (a single frame's
 * volts can only ever show the multiplexed digit under strobe, which is why
 * the core transports the latch), and LCD text replayed through `LcdDriver`
 * commands into a `createLcd` panel. Servos keep the existing real-model
 * drive (`Servo.write`); pixels stay plain RGB triplets. Steppers are the
 * documented exception: the core's display region carries no stepper bytes
 * (shaft angles derive from coil-volt edge counting inside the solver, which
 * has no frame encoding), so the worker path shows the last in-page angles.
 * Map tiles ride the real tile port in the core (Task 7: the store + fetcher
 * moved in-feature to `simulation/map`, and tile decode is worker-safe). The
 * colour TFT crosses in the fixed `tft` sub-region as
 * `{ width, height, rgb565 }` and decodes here to `ImageData` — or to a
 * rebuilt `Ili9341` for the existing canvas blit path.
 *
 * Worker entry sequencing: the entry owns the worker side of the message
 * contract (`attachBuffer` is its realloc-reply landing: the realloc reply
 * carries the new SharedArrayBuffer). The factory returns a live client
 * whenever Worker + SHM + port construction succeed; the init handshake
 * attaches the first frame, after which per-rAF `poll()` ingests frames and
 * posts one `ack` per consumed frame.
 *
 * Main-thread imports stay narrow: protocol views + plain types + the AVR
 * toolchain path via the simulation barrel. Never Engine/McuRuntime/
 * AvrBackend/FirmwareRunner here.
 */

import {
  allocSnapshot,
  compileInWorker,
  compileProjectWithLibraries,
  createProductionBackend,
  createProjectLibraryContext,
  createSimWorker,
  displayView,
  headerView,
  hexForSourcesHash,
  layoutFor,
  libraryDeclarations,
  lintPrototypes,
  netView,
  packageSketch,
  parseIntelHex,
  pinNodeView,
  projectSlots,
  resolveWasmFlag,
  restoreInstalledIndex,
  serialRing,
  SNAP_MAGIC,
  SNAP_VERSION,
  sourcesHashForProject,
  tftView,
  validateLibraries,
  type Bench,
  type CompileResult,
  type FirmwareProject,
  type ProjectLibraryContext,
  type ScriptFault,
  type SnapshotLayout,
} from '@/features/simulation';
import {
  createLcd,
  DynamicState,
  Ili9341,
  LcdDriver,
  pixelCount,
  SSD1306_FLAG_LIT,
  SSD1306_FLAG_MIRRORED,
  SSD1306_FRAME_BYTES,
  SevenSegment,
  Ssd1306,
  type KnobSpec,
  type Lcd1602,
  type LcdCommand,
  type PartDefinition,
} from '@/features/parts';

/** Which backend owns stepping, for the status lamp. */
export interface WorkerStatus {
  readonly backend: 'worker' | 'in-page';
  readonly fps: number;
  readonly ratio: number;
}

/** Main-thread copy of one SHM frame. Layout stays verbatim per the brief. */
export interface MirrorState {
  layout: SnapshotLayout | null;
  pinVolts: Map<string, number>;
  values: Map<string, number[]>;
  colon: Map<string, boolean>;
  serial: string[];
}

/** Last ingested generation per mirror (kept outside the verbatim shape). */
const lastGeneration = new WeakMap<MirrorState, number>();

/** Serial chunks kept before the oldest fall off, as in `Simulation`. */
const SERIAL_CAP = 400;
/** LCD text bytes per frame, matching the core writer. */
const LCD_TEXT_BYTES = 80;

function layoutsEqual(a: SnapshotLayout, b: SnapshotLayout): boolean {
  return (
    a.headerBytes === b.headerBytes &&
    a.netFloats === b.netFloats &&
    a.pinNodeUints === b.pinNodeUints &&
    a.displayBytes === b.displayBytes &&
    a.serialBytes === b.serialBytes
  );
}

/**
 * Layout dims read back from the buffer alone via the protocol views. Built
 * through `layoutFor` so the header size stays the protocol's, not a copy.
 */
function dimsOf(buf: SharedArrayBuffer): SnapshotLayout {
  return layoutFor(
    netView(buf).length,
    pinNodeView(buf).length,
    displayView(buf).length,
    serialRing(buf).capacity,
  );
}

const textDecoder = new TextDecoder();

/**
 * Pure frame-ingest path. Copies the frame on `'ok'`, holds the last copy on
 * `'stale'`, and rebinds (clearing per-frame maps, keeping accumulated
 * serial) on `'reallocated'`.
 */
export function ingestSnapshot(
  state: MirrorState,
  buf: SharedArrayBuffer,
): 'ok' | 'reallocated' | 'stale' {
  let generation: number;
  let current: SnapshotLayout;
  try {
    generation = headerView(buf).generation;
    current = dimsOf(buf);
  } catch {
    return 'stale';
  }
  const previous = state.layout;
  if (previous === null) {
    state.layout = current;
    copyFrame(state, buf);
    lastGeneration.set(state, generation);
    return 'ok';
  }
  if (!layoutsEqual(previous, current)) {
    state.layout = current;
    lastGeneration.set(state, generation);
    state.pinVolts.clear();
    state.values.clear();
    state.colon.clear();
    tftFrames.set(state, null);
    return 'reallocated';
  }
  if (lastGeneration.get(state) === generation) return 'stale';
  try {
    copyFrame(state, buf);
  } catch {
    return 'stale';
  }
  lastGeneration.set(state, generation);
  return 'ok';
}

/**
 * Raw copy without bench knowledge: pin-slot volts keyed `pin:<index>`, all
 * display bytes as one `raw` entry, drained serial text appended. The client
 * remaps these with the bench snapshot (see `remapWithBench`).
 */
function copyFrame(state: MirrorState, buf: SharedArrayBuffer): void {
  const nets = netView(buf);
  const pins = pinNodeView(buf);
  state.pinVolts.clear();
  for (let i = 0; i < pins.length; i++) {
    const node = pins.read(i);
    state.pinVolts.set(`pin:${i}`, node < nets.length ? nets.read(node) : 0);
  }
  const display = displayView(buf);
  state.values.clear();
  state.values.set('raw', Array.from(display.array));
  state.colon.clear();
  const frame = tftView(buf).readFrame();
  tftFrames.set(state, frame.width > 0 && frame.height > 0 ? frame : null);
  const drained = serialRing(buf).drain();
  if (drained.length > 0) {
    const text = textDecoder.decode(new Uint8Array(drained));
    if (text !== '') {
      state.serial.push(text);
      if (state.serial.length > SERIAL_CAP)
        state.serial.splice(0, state.serial.length - SERIAL_CAP);
    }
  }
}

/** Display bytes one bench part owns, matching the core writer order. */
function displayBytesForPart(definition: PartDefinition): number {
  const component = definition.component;
  if (component.kind === '7segment') return (component.digits ?? 1) + 1;
  if (component.kind === 'lcd') return LCD_TEXT_BYTES + 1;
  if (component.kind === 'servo') return 1;
  if (
    component.kind === 'display' &&
    (component.controller === 'ssd1306' || component.controller === 'ssd1306-spi')
  ) {
    // The panel's own memory, plus the byte that says whether the glass is
    // lit and whether the image is mirrored.
    return SSD1306_FRAME_BYTES + 1;
  }
  if (
    component.kind === 'neopixel' ||
    component.kind === 'neopixel-matrix' ||
    component.kind === 'led-ring'
  ) {
    return pixelCount(definition) * 3;
  }
  return 0;
}

/**
 * Remaps the raw ingest copy with the bench snapshot: `pin:<index>` slots in
 * netlist order (bench parts order, every pin incl. breadboard) become
 * `${partId}:${pinId}` volts (breadboard holes excluded from output, matching
 * `Simulation.pinVoltages`), and the raw display blob is split per part in
 * bench order with 7-segment colon bytes lifted into `colon`.
 */
export function remapWithBench(state: MirrorState, bench: Bench): void {
  const raw = state.values.get('raw');
  if (raw === undefined) return;
  const perPart = new Map<string, number[]>();
  const colon = new Map<string, boolean>();
  let offset = 0;
  for (const part of bench.parts) {
    const size = displayBytesForPart(part.definition);
    if (size <= 0) continue;
    const slice = raw.slice(offset, offset + size);
    offset += size;
    perPart.set(part.id, slice);
    if (part.definition.component.kind === '7segment') {
      colon.set(part.id, (slice[slice.length - 1] ?? 0) !== 0);
    }
  }
  state.values.clear();
  for (const [id, bytes] of perPart) state.values.set(id, bytes);
  state.colon.clear();
  for (const [id, lit] of colon) state.colon.set(id, lit);

  const remapped = new Map<string, number>();
  let slot = 0;
  for (const part of bench.parts) {
    const isBreadboard = part.definition.component.kind === 'breadboard';
    for (const pinId of Object.keys(part.terminals)) {
      const volts = state.pinVolts.get(`pin:${slot}`) ?? 0;
      slot += 1;
      if (!isBreadboard) remapped.set(`${part.id}:${pinId}`, volts);
    }
  }
  state.pinVolts.clear();
  for (const [key, volts] of remapped) state.pinVolts.set(key, volts);
}

/**
 * Rebuilds a 7-segment controller from mirrored pattern bytes. Each digit is
 * replayed through the public timeless `update` path with only that digit's
 * common asserted, so every digit latches exactly its own pattern — a fresh
 * instance latches on first sighting, and earlier digits are untouched while
 * later ones land.
 */
export function sevenSegmentFromSnapshot(
  digits: number,
  patterns: readonly number[],
  colonLit: boolean,
  logicVolts = 5,
): SevenSegment {
  const count = Math.min(Math.max(Math.floor(digits), 1), 4);
  const seven = new SevenSegment(count);
  const high = logicVolts;
  for (let digit = 0; digit < count; digit++) {
    const pattern = patterns[digit] ?? 0;
    const segVolts: number[] = [];
    for (let index = 0; index < 8; index++)
      segVolts.push(((pattern >> index) & 1) === 1 ? 0 : high);
    const digitVolts: number[] = [];
    for (let index = 0; index < count; index++) digitVolts.push(index === digit ? high : 0);
    seven.update(digitVolts, segVolts, high, colonLit ? 0 : high);
  }
  return seven;
}

/**
 * Rebuilds a character LCD from mirrored text bytes + flags. The text is
 * replayed through `LcdDriver` commands into a `createLcd` panel, so DDRAM
 * lands exactly where the worker's panel held it; the backlight follows the
 * flags byte. The glass-lit flag travels in the frame but no renderer reads
 * it (and no controller API exposes display-off), so replay leaves the glass
 * on — recorded here rather than faked.
 */
export function lcdFromSnapshot(
  definition: PartDefinition,
  textBytes: readonly number[],
  flags: number,
): Lcd1602 | null {
  const panel = createLcd(definition);
  if (panel === null) return null;
  const driver = new LcdDriver(panel);
  const feed = (commands: readonly LcdCommand[]): void => {
    for (const command of commands) {
      panel.receive(command.isData, (command.value >> 4) & 0x0f);
      panel.receive(command.isData, command.value & 0x0f);
    }
  };
  feed(driver.begin(panel.columns, panel.rows));
  const text = textDecoder.decode(new Uint8Array(textBytes)).split('\0')[0] ?? '';
  const rows = text.split('\n');
  rows.forEach((line, row) => {
    if (row >= panel.rows) return;
    feed(driver.setCursor(0, row));
    feed(driver.text(line.slice(0, panel.columns)));
  });
  panel.setBacklight((flags & 0x02) !== 0);
  return panel;
}

/**
 * Rebuilds a monochrome OLED from the frame the worker mirrored.
 *
 * The frame is the panel's own memory -- one byte per column per page -- so
 * putting it back is putting the panel back: the pixels are the pixels. The
 * flags say whether the glass is lit and whether the image is mirrored, which
 * is what the panel was showing, not only what it drew.
 */
export function ssd1306FromSnapshot(
  frameBytes: Uint8Array | readonly number[],
  flags: number,
): Ssd1306 {
  const panel = new Ssd1306();
  panel.loadFrame(new Uint8Array(frameBytes), {
    lit: (flags & SSD1306_FLAG_LIT) !== 0,
    mirrored: (flags & SSD1306_FLAG_MIRRORED) !== 0,
  });
  return panel;
}

/** One colour-TFT frame as it crosses SHM: visible size + RGB565 bytes. */
export interface TftSnapshot {
  readonly width: number;
  readonly height: number;
  readonly rgb565: Uint8Array;
}

/** Latest TFT frame per mirror (kept outside the verbatim shape, as above). */
const tftFrames = new WeakMap<MirrorState, TftSnapshot | null>();

/** Latest TFT frame a mirror holds, or null when no TFT is on the bench. */
export function tftFromMirror(state: MirrorState): TftSnapshot | null {
  return tftFrames.get(state) ?? null;
}

/**
 * Expands visible-order RGB565 bytes to RGBA, for `ImageData`.
 *
 * The same 5/6/5-bit replication `Ili9341.toRgba` does, factored out so the
 * mirror can hand the canvas path pixels without owning a controller: the
 * frame is already in reading order, so no transpose and no panel model.
 */
export function tftRgbaFromFrame(
  width: number,
  height: number,
  rgb565: Uint8Array,
): Uint8ClampedArray<ArrayBuffer> {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const pixels = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const count = Math.min(w * h, Math.floor(rgb565.length / 2));
  for (let i = 0; i < count; i++) {
    const colour = ((rgb565[i * 2] ?? 0) << 8) | (rgb565[i * 2 + 1] ?? 0);
    const o = i * 4;
    const red = (colour >> 11) & 0x1f;
    const green = (colour >> 5) & 0x3f;
    const blue = colour & 0x1f;
    pixels[o] = (red << 3) | (red >> 2);
    pixels[o + 1] = (green << 2) | (green >> 4);
    pixels[o + 2] = (blue << 3) | (blue >> 2);
    pixels[o + 3] = 0xff;
  }
  return pixels;
}

/**
 * Decodes a frame straight to `ImageData` for the existing canvas blit path
 * (`createImageData` + `putImageData` at the panel's own size).
 */
export function tftImageDataFromFrame(
  width: number,
  height: number,
  rgb565: Uint8Array,
): ImageData {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  return new ImageData(tftRgbaFromFrame(w, h, rgb565), w, h);
}

/**
 * Rebuilds a colour TFT from a mirrored frame for renderers that read a
 * controller (the bench canvas blits `Ili9341.toRgba`). A fresh panel of the
 * frame's own visible size with the whole frame blitted at the origin shows
 * exactly what the worker's panel showed: the frame is already in visible
 * order, so rotation is baked in rather than reapplied.
 */
export function tftFromSnapshot(width: number, height: number, rgb565: Uint8Array): Ili9341 | null {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w <= 0 || h <= 0 || w * h * 2 > rgb565.length) return null;
  const panel = new Ili9341(w, h);
  const words = new Uint16Array(w * h);
  for (let i = 0; i < words.length; i++) {
    words[i] = ((rgb565[i * 2] ?? 0) << 8) | (rgb565[i * 2 + 1] ?? 0);
  }
  panel.blit(0, 0, w, h, words);
  return panel;
}

/**
 * Seam for the compile path. Production uses the real toolchain clients;
 * tests inject stubs that record which path a project takes — the same way
 * `Simulation` wraps its backends rather than reaching for a global.
 */
export interface WorkerClientDeps {
  readonly avrCompile?: typeof compileInWorker;
  readonly avrProjectCompile?: typeof compileProjectWithLibraries;
  /** Installed index entries for validation; absent falls back to the IDB object cache. */
  readonly indexInstalled?: ProjectLibraryContext['indexInstalled'];
  /** Installed-index object builds; absent uses the production index build. */
  readonly indexBuild?: ProjectLibraryContext['index'];
}

/** Reason text out of a toolchain rejection, as in `Simulation`. */
function compileDetail(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message !== '') {
      const tab = (error as { tab?: unknown }).tab;
      const line = (error as { line?: unknown }).line;
      if (
        typeof tab === 'string' &&
        tab !== '' &&
        typeof line === 'number' &&
        Number.isInteger(line) &&
        line > 0
      ) {
        return `${tab}:${line}: ${message}`;
      }
      return message;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Whether a project builds through the multi-TU library path: any declared
 * libraries, or custom slots carrying files. Same rule as `Simulation`.
 */
function hasLibraryBuild(project: FirmwareProject): boolean {
  if (libraryDeclarations(project).length > 0) return true;
  return projectSlots(project).some((slot) => slot.files.length > 0);
}

/** UI-read seam Bench uses (plain-data snapshots; TFT arrives via `tftSnapshot`). */
export interface WorkerClient {
  readonly controls: DynamicState;
  readonly running: boolean;
  start(): void;
  stop(): void;
  pinVoltages(): ReadonlyMap<string, number>;
  displaySnapshots(): ReadonlyMap<string, readonly number[]>;
  colonFlags(): ReadonlyMap<string, boolean>;
  /** Latest colour-TFT frame, or null when no TFT is on the bench. */
  tftSnapshot(): TftSnapshot | null;
  serialLines(): readonly string[];
  setPressed(partId: string, pressed: boolean): void;
  setKnob(partId: string, spec: KnobSpec, value: number): void;
  /** Fast-forward multiplier for the self-paced tick: 1 is real time. */
  setSpeed(scale: number): void;
  /** Chooses the backend the next init runs on. */
  setExecution(execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32'): void;
  loadFirmware(project: FirmwareProject): void;
  compileAndRun(project: FirmwareProject): Promise<void>;
  cancelCompile(): void;
  sendBench(bench: Bench): void;
  /**
   * Lands the realloc reply's buffer. Task 5 calls this with the new
   * SharedArrayBuffer; tests use it to feed scripted frames to `poll`.
   */
  attachBuffer(buf: SharedArrayBuffer): void;
  poll(): 'ok' | 'reallocated' | 'stale';
  status(): WorkerStatus;
  /** Script faults the worker has latched, as of the last refresh. */
  faults(): readonly ScriptFault[];
  readonly fault: string | null;
  readonly timeMs: number;
  readonly serialOverflow: boolean;
  dispose(): void;
}

/**
 * Bench-side message port to the sim worker. The production port wraps a
 * real `Worker` from the simulation barrel factory; tests inject a fake
 * with the same three fields (no DOM Worker needed).
 */
export interface SimWorkerPort {
  postMessage(msg: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate(): void;
}

/**
 * A fault row as the worker sends it, or null for anything else.
 *
 * The reply crosses a realm boundary, so it is shaped data rather than a type:
 * the guard is the boundary, and the panel renders only what it passed.
 */
function asFaultRows(value: unknown): readonly ScriptFault[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ScriptFault[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') return null;
    if (!('partId' in entry) || !('fault' in entry)) return null;
    if (typeof entry.partId !== 'string' || typeof entry.fault !== 'string') return null;
    rows.push({ partId: entry.partId, fault: entry.fault });
  }
  return rows;
}

class WorkerClientImpl implements WorkerClient {
  readonly controls = new DynamicState();
  private readonly boardDef: PartDefinition;
  private readonly avrCompile: typeof compileInWorker;
  private readonly avrProjectCompile: typeof compileProjectWithLibraries;
  private readonly depsIndexInstalled: ProjectLibraryContext['indexInstalled'];
  private readonly depsIndexBuild: ProjectLibraryContext['index'];
  private isRunning = false;
  private readonly mirror: MirrorState = {
    layout: null,
    pinVolts: new Map(),
    values: new Map(),
    colon: new Map(),
    serial: [],
  };
  private bench: Bench | null = null;
  private live: SharedArrayBuffer | null = null;
  private loadedFirmware: FirmwareProject | null = null;
  private execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32' = 'interpreter';
  private wasm = false;
  /* Whether this bench's network may bridge to real hosts. Build data, set
   * once: a worker is recreated when the board or bench changes, and the flag
   * travels in `init` because the worker owns its own network. */
  private liveNetwork = false;
  private faultText: string | null = null;
  private faultRows: readonly ScriptFault[] = [];
  private faultPolls = 0;
  private compileAbort: AbortController | null = null;
  private stagedHex: Uint16Array | null = null;
  private overflowSticky = false;
  private disposed = false;
  private samples: Array<{ wall: number; timeMs: number }> = [];
  private lastTimeMs = 0;
  private port: SimWorkerPort | null = null;
  private onPortFallback: ((reason: string) => void) | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, string>();
  private readonly outbox: Array<{ id: number; type: string; msg: Record<string, unknown> }> = [];
  private handshakeOk = false;
  private demoted = false;
  private initSentFirmware: FirmwareProject | null = null;

  constructor(
    board: PartDefinition,
    deps?: WorkerClientDeps,
    portInit?: {
      port: SimWorkerPort;
      bench: Bench;
      firmware: FirmwareProject;
      execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32';
      wasm?: boolean;
      liveNetwork?: boolean;
      onFallback: (reason: string) => void;
    },
  ) {
    this.boardDef = board;
    this.avrCompile = deps?.avrCompile ?? compileInWorker;
    this.avrProjectCompile = deps?.avrProjectCompile ?? compileProjectWithLibraries;
    this.depsIndexInstalled = deps?.indexInstalled;
    this.depsIndexBuild = deps?.indexBuild;
    if (portInit !== undefined) {
      this.port = portInit.port;
      this.bench = portInit.bench;
      this.loadedFirmware = portInit.firmware;
      this.execution = portInit.execution;
      this.wasm = portInit.wasm ?? false;
      this.liveNetwork = portInit.liveNetwork ?? false;
      this.onPortFallback = portInit.onFallback;
      this.port.onmessage = (event) => this.handleReply(event.data);
      this.sendInit();
    }
  }

  get running(): boolean {
    return this.isRunning;
  }

  get fault(): string | null {
    return this.faultText;
  }

  get timeMs(): number {
    return this.lastTimeMs;
  }

  get serialOverflow(): boolean {
    return this.overflowSticky;
  }

  start(): void {
    this.isRunning = true;
    this.post('start');
  }

  stop(): void {
    this.isRunning = false;
    this.post('stop');
  }

  pinVoltages(): ReadonlyMap<string, number> {
    return this.mirror.pinVolts;
  }

  displaySnapshots(): ReadonlyMap<string, readonly number[]> {
    return this.mirror.values;
  }

  colonFlags(): ReadonlyMap<string, boolean> {
    return this.mirror.colon;
  }

  tftSnapshot(): TftSnapshot | null {
    return tftFromMirror(this.mirror);
  }

  serialLines(): readonly string[] {
    return [...this.mirror.serial];
  }

  setPressed(partId: string, pressed: boolean): void {
    this.controls.setPressed(partId, pressed);
    this.post('press', { partId, down: pressed });
  }

  setKnob(partId: string, spec: KnobSpec, value: number): void {
    this.controls.setKnob(partId, spec, value);
    this.post('knob', { partId, spec, value });
  }

  /**
   * Fast-forward multiplier for the worker's self-paced tick: 1 is real
   * time, 2 buys twice the sketch time per tick. The worker keeps the value
   * across rebuilds; a fresh worker starts at 1 until this arrives.
   */
  setSpeed(scale: number): void {
    this.post('speed', { scale });
  }

  /**
   * Chooses the backend the next init runs on.
   *
   * The client is built once per simulation, so the mode has to be settable:
   * the worker core takes the execution with its `init`, and a Run posts a
   * fresh one anyway.
   */
  setExecution(execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32'): void {
    this.execution = execution;
  }

  loadFirmware(project: FirmwareProject): void {
    this.loadedFirmware = project;
    this.faultText = null;
    this.mirror.serial.length = 0;
    // A new sketch rebuilds the worker core: `edit` reuses the stored
    // firmware, so only `init` carries a fresh one.
    if (this.port !== null) this.sendInit();
  }

  /**
   * Compiles in the main-thread toolchain worker and stages the HEX for the
   * Task 5 flash message — the same decision tree as `Simulation.compileAndRun`
   * (Uno gate, index restore, declaration guard, single- vs multi-TU route,
   * bundled-HEX landing). Never rejects: failures report through `fault`.
   */
  async compileAndRun(project: FirmwareProject): Promise<void> {
    this.compileAbort?.abort();
    const controller = new AbortController();
    this.compileAbort = controller;
    const signal = controller.signal;

    // PartDefinitions carry the catalogue id ('arduino-uno-r3'); the board
    // id lives on the mcu component ('uno'). Test fakes pass a bare
    // `{ id: 'uno' }`, so fall back to the top-level id when not an mcu.
    const boardId =
      this.boardDef.component?.kind === 'mcu' ? this.boardDef.component.board.id : this.boardDef.id;
    if (boardId !== 'uno') {
      this.loadFirmware(project);
      this.faultText = 'AVR backend needs an Uno board';
      if (this.compileAbort === controller) this.compileAbort = null;
      return;
    }

    const slots = projectSlots(project);
    // Projects without index declarations skip the restore entirely.
    const wantsIndex = libraryDeclarations(project).some((entry) => entry.source === 'index');
    const indexInstalled =
      this.depsIndexInstalled ?? (wantsIndex ? await this.restoreIndex(project) : undefined);
    const declarationErrors = validateLibraries(project, { slots, indexInstalled });
    if (declarationErrors.length > 0) {
      this.loadFirmware(project);
      this.faultText = `declared libraries invalid: ${declarationErrors.join('; ')}`;
      if (this.compileAbort === controller) this.compileAbort = null;
      return;
    }

    // Lint hints stay notices: they inform, they never block the worker.
    const packed = packageSketch(project);
    lintPrototypes(packed.source);

    let compiled: CompileResult;
    try {
      if (hasLibraryBuild(project)) {
        compiled = await this.avrProjectCompile(
          project,
          {
            ...createProjectLibraryContext(slots, { indexInstalled }),
            ...(this.depsIndexBuild !== undefined ? { index: this.depsIndexBuild } : {}),
          },
          () => {},
          signal,
        );
      } else {
        compiled = await this.avrCompile(packed.source, () => {}, signal);
      }
    } catch (error) {
      if (this.compileAbort !== controller) return;
      this.compileAbort = null;
      if (signal.aborted) {
        this.faultText = 'compile cancelled';
        return;
      }
      this.landCompileFailure(project, compileDetail(error));
      return;
    }

    if (this.compileAbort !== controller || signal.aborted) {
      if (signal.aborted && this.compileAbort === controller) {
        this.compileAbort = null;
        this.faultText = 'compile cancelled';
      }
      return;
    }
    this.compileAbort = null;
    this.loadFirmware(project);
    this.stagedHex = compiled.hex;
    this.faultText = null;
    this.postFlash();
  }

  cancelCompile(): void {
    this.compileAbort?.abort();
  }

  sendBench(bench: Bench): void {
    this.bench = bench;
    // Structural edits rebuild the worker core; the `realloc` reply carries
    // the new SharedArrayBuffer into `live`. Queued until the handshake when
    // the worker cannot serve `edit` yet.
    if (this.port !== null) this.post('edit', { bench });
  }

  attachBuffer(buf: SharedArrayBuffer): void {
    this.live = buf;
  }

  poll(): 'ok' | 'reallocated' | 'stale' {
    const buf = this.live;
    if (buf === null || this.disposed) return 'stale';
    const outcome = ingestSnapshot(this.mirror, buf);
    if (outcome === 'ok' && this.bench !== null) remapWithBench(this.mirror, this.bench);
    if (outcome === 'ok') {
      try {
        this.lastTimeMs = headerView(buf).timeMs;
        if (headerView(buf).overflow === 1) this.overflowSticky = true;
      } catch {
        // Header unreadable: keep the last time, report stale next frame.
      }
      const now = performance.now();
      this.samples.push({ wall: now, timeMs: this.lastTimeMs });
      this.pruneSamples(now);
      // Drain the entry's backpressure: one ack per consumed frame carries
      // the generation just drawn, so the worker never stalls past
      // MAX_UNREAD_FRAMES while frames are being consumed.
      try {
        this.post('ack', { generation: headerView(buf).generation });
      } catch {
        // Header unreadable: skip the ack, the next frame carries on.
      }
      // Faults are rare and latched; twice a second is far more often than a
      // row can change, and it keeps the panel current within a blink.
      if (++this.faultPolls % 30 === 0) this.post('faults');
    }
    return outcome;
  }

  faults(): readonly ScriptFault[] {
    return this.faultRows;
  }

  status(): WorkerStatus {
    const now = performance.now();
    this.pruneSamples(now);
    let ratio = 0;
    if (this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      if (first !== undefined && last !== undefined) {
        ratio = (last.timeMs - first.timeMs) / Math.max(last.wall - first.wall, 1);
      }
    }
    return { backend: 'worker', fps: this.samples.length, ratio };
  }

  dispose(): void {
    this.disposed = true;
    this.compileAbort?.abort();
    try {
      this.port?.terminate();
    } catch {
      // Terminate is best-effort on the way out.
    }
    this.port = null;
    this.pending.clear();
    this.outbox.length = 0;
  }

  /**
   * Posts a worker message, queuing until the init handshake lands. `init`
   * always goes immediately (the worker serves it uninitialised); `ack`
   * skips pending tracking (per-frame churn whose replies carry nothing).
   */
  private post(type: string, fields: Record<string, unknown> = {}): void {
    const port = this.port;
    if (port === null || this.demoted || this.disposed) return;
    const id = this.nextId++;
    const msg = { id, type, ...fields };
    if (!this.handshakeOk && type !== 'init') {
      this.outbox.push({ id, type, msg });
      return;
    }
    if (type !== 'ack') this.pending.set(id, type);
    try {
      port.postMessage(msg);
    } catch {
      this.demote('sim worker post failed');
    }
  }

  /** Rebuilds the worker core with the current bench, firmware, and execution. */
  private sendInit(): void {
    const bench = this.bench;
    const firmware = this.loadedFirmware;
    if (bench === null || firmware === null) return;
    this.initSentFirmware = firmware;
    const port = this.port;
    if (port === null || this.demoted || this.disposed) return;
    const id = this.nextId++;
    this.pending.set(id, 'init');
    try {
      port.postMessage({
        id,
        type: 'init',
        bench,
        firmware,
        execution: this.execution,
        wasm: this.wasm,
        liveNetwork: this.liveNetwork,
      });
    } catch {
      this.demote('sim worker post failed');
    }
  }

  /** Flashes the staged HEX onto the worker's AVR core. */
  private postFlash(): void {
    if (this.stagedHex !== null && this.port !== null)
      this.post('flash', { words: this.stagedHex });
  }

  /**
   * Handles one worker reply. `ok:false` (protocol fault, version mismatch,
   * or a synthesised crash notice) demotes to in-page through the fallback
   * path; `ok:true` with a `fault` string is a firmware verdict that stays
   * on the worker path and surfaces via `fault`.
   */
  private handleReply(data: unknown): void {
    if (data === null || typeof data !== 'object') return;
    const reply = data as {
      id?: unknown;
      ok?: unknown;
      buffer?: unknown;
      realloc?: unknown;
      fault?: unknown;
      error?: unknown;
      rows?: unknown;
    };
    if (typeof reply.id !== 'number') return;
    const kind = this.pending.get(reply.id);
    if (reply.ok === false) {
      const detail =
        typeof reply.error === 'string' && reply.error !== '' ? reply.error : 'worker fault';
      this.pending.delete(reply.id);
      this.demote(`sim worker fault: ${detail}`);
      return;
    }
    if (reply.ok !== true) return;
    this.pending.delete(reply.id);
    if (typeof reply.fault === 'string' && reply.fault !== '') {
      this.faultText = reply.fault;
    } else if (reply.fault === null && (kind === 'init' || kind === 'edit')) {
      this.faultText = null;
    }
    if (kind === 'init') {
      const buf = reply.buffer as SharedArrayBuffer | undefined;
      if (!this.checkHandshakeBuffer(buf)) return;
      this.attachBuffer(buf as SharedArrayBuffer);
      this.handshakeOk = true;
      if (this.loadedFirmware !== this.initSentFirmware) {
        // The sketch moved while the handshake was in flight: rebuild with
        // it, dropping queued bench edits (the fresh init carries the latest
        // bench; other queued inputs still flush after it).
        for (let i = this.outbox.length - 1; i >= 0; i--) {
          if (this.outbox[i]?.type === 'edit') this.outbox.splice(i, 1);
        }
        this.sendInit();
      }
      this.flushOutbox();
    } else if (kind === 'faults') {
      const rows = asFaultRows(reply.rows);
      if (rows !== null) this.faultRows = rows;
    } else if (kind === 'edit' && reply.realloc === true) {
      const buf = reply.buffer as SharedArrayBuffer | undefined;
      if (!this.checkHandshakeBuffer(buf)) return;
      this.attachBuffer(buf as SharedArrayBuffer);
    }
  }

  /** Validates a handshake/realloc buffer, demoting on version mismatch. */
  private checkHandshakeBuffer(buf: unknown): buf is SharedArrayBuffer {
    try {
      if (buf instanceof SharedArrayBuffer) {
        const head = headerView(buf);
        if (head.magic === SNAP_MAGIC && head.version === SNAP_VERSION) return true;
      }
    } catch {
      // Falls through to the demotion below.
    }
    this.demote('sim worker unavailable: snapshot version handshake mismatch');
    return false;
  }

  /** Sends queued messages in order, now the worker can serve them. */
  private flushOutbox(): void {
    const port = this.port;
    if (port === null || this.demoted || this.disposed) {
      this.outbox.length = 0;
      return;
    }
    for (const queued of this.outbox) {
      this.pending.set(queued.id, queued.type);
      try {
        port.postMessage(queued.msg);
      } catch {
        this.demote('sim worker post failed');
        break;
      }
    }
    this.outbox.length = 0;
  }

  /** Demotes to in-page: stops the port and reports through the fallback path. */
  private demote(reason: string): void {
    if (this.demoted) return;
    this.demoted = true;
    this.handshakeOk = false;
    try {
      this.port?.terminate();
    } catch {
      // Terminate is best-effort on the way out.
    }
    this.port = null;
    this.pending.clear();
    this.outbox.length = 0;
    this.onPortFallback?.(reason);
  }

  /** Drops samples older than the one-second poll window. */
  private pruneSamples(now: number): void {
    while (this.samples.length > 0 && now - (this.samples[0]?.wall ?? now) > 1000)
      this.samples.shift();
  }

  /**
   * Worker/build/parse failure landing: the bundled HEX when its staged
   * sources hash to this exact project, else a plain fault. The worker core
   * falls back to its interpreter runner silently when no flash arrives, as
   * `Simulation` does in-page.
   */
  private landCompileFailure(project: FirmwareProject, detail: string): void {
    const bundled = hexForSourcesHash(sourcesHashForProject(project));
    if (bundled !== null) {
      try {
        const program = parseIntelHex(bundled);
        this.loadFirmware(project);
        this.stagedHex = program;
        this.faultText = `compile failed, running bundled HEX: ${detail}`;
        this.postFlash();
        return;
      } catch {
        // A corrupt committed HEX falls through to the fault below.
      }
    }
    this.loadFirmware(project);
    this.faultText = detail.includes('compile failed') ? detail : `compile failed: ${detail}`;
  }

  /**
   * Rebuilds the installed-index map from the versioned object cache, as in
   * `Simulation`: declarations persist with the project while the session
   * map does not. Any cache failure restores empty; an injected map wins.
   */
  private restoreIndex(
    project: FirmwareProject,
  ): Promise<ReadonlyMap<string, { headers: readonly string[] }> | undefined> {
    const wanted = libraryDeclarations(project).filter((entry) => entry.source === 'index');
    if (wanted.length === 0) return Promise.resolve(undefined);
    return restoreInstalledIndex(wanted, createProductionBackend()).catch(
      () => new Map<string, { headers: readonly string[] }>(),
    );
  }
}

/**
 * Wraps the barrel worker factory in the injectable port shape: worker
 * messages in, replies out, and a crash notice synthesised through the same
 * `onmessage` channel so the client demotes on it like any other fault.
 */
function defaultPort(): SimWorkerPort {
  const worker = createSimWorker();
  const port: SimWorkerPort = {
    postMessage: (msg) => worker.postMessage(msg),
    onmessage: null,
    terminate: () => worker.terminate(),
  };
  worker.onmessage = (event: MessageEvent) => port.onmessage?.({ data: event.data });
  worker.onerror = () =>
    port.onmessage?.({ data: { id: -1, ok: false, error: 'sim worker crashed' } });
  return port;
}

/** Minimal bench carrying only the board, until the first `sendBench`. */
function minimalBench(board: PartDefinition): Bench {
  return {
    parts: [{ id: 'board', definition: board, x: 0, y: 0, rotation: 0, terminals: {} }],
    wires: [],
    terminals: [],
    revision: 0,
  } as Bench;
}

/** Empty blink until the first `loadFirmware`. */
function minimalFirmware(): FirmwareProject {
  return {
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
  };
}

/**
 * Builds the worker client, or null after `onFallback` when the worker path
 * cannot run: `forceNoWorker`, no `Worker` global (unless a `createPort` is
 * injected, which bypasses the global for tests), SHM construction throwing
 * (e.g. no isolation), a version-handshake mismatch, or port construction
 * throwing. Later transport faults demote through the same `onFallback`.
 */
export function createWorkerClient(opts: {
  board: PartDefinition;
  bench?: Bench;
  firmware?: FirmwareProject;
  execution?: 'interpreter' | 'avr' | 'rp2040' | 'esp32';
  wasm?: boolean;
  /** Whether this bench's network may bridge to real hosts (build data). */
  liveNetwork?: boolean;
  onFallback: (reason: string) => void;
  forceNoWorker?: boolean;
  createPort?: () => SimWorkerPort;
  deps?: WorkerClientDeps;
}): WorkerClient | null {
  const { board, onFallback, forceNoWorker } = opts;
  if (forceNoWorker === true) {
    onFallback('sim worker disabled (forceNoWorker)');
    return null;
  }
  if (opts.createPort === undefined && typeof Worker === 'undefined') {
    onFallback('sim worker unavailable: this environment has no Worker');
    return null;
  }
  try {
    const probe = allocSnapshot(layoutFor(1, 1, 16));
    const head = headerView(probe);
    if (head.magic !== SNAP_MAGIC || head.version !== SNAP_VERSION) {
      onFallback('sim worker unavailable: snapshot version handshake mismatch');
      return null;
    }
  } catch (error) {
    onFallback(
      `sim worker unavailable: shared memory failed (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
  let port: SimWorkerPort;
  try {
    port = opts.createPort?.() ?? defaultPort();
  } catch (error) {
    onFallback(
      `sim worker unavailable: worker construction failed (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
  return new WorkerClientImpl(board, opts.deps, {
    port,
    bench: opts.bench ?? minimalBench(board),
    firmware: opts.firmware ?? minimalFirmware(),
    execution: opts.execution ?? 'interpreter',
    wasm: resolveWasmFlag(opts.wasm),
    liveNetwork: opts.liveNetwork ?? false,
    onFallback,
  });
}

export { WorkerClientImpl };
