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
 * Map tiles and TFT framebuffers are OUT of scope (Task 7 owns tile
 * injection + TFT transport; no attempt here).
 *
 * Worker entry sequencing: Task 5 owns the worker entry + message contract
 * (`attachBuffer` is its realloc-reply landing: the realloc reply carries
 * the new SharedArrayBuffer). The factory returns a live client whenever
 * Worker + SHM + handshake succeed; frames start flowing once Task 5 drives
 * the port.
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
  restoreInstalledIndex,
  serialRing,
  SNAP_MAGIC,
  SNAP_VERSION,
  sourcesHashForProject,
  validateLibraries,
  type Bench,
  type CompileResult,
  type FirmwareProject,
  type ProjectLibraryContext,
  type SnapshotLayout,
} from '@/features/simulation';
import {
  createLcd,
  DynamicState,
  LcdDriver,
  pixelCount,
  SevenSegment,
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
export function ingestSnapshot(state: MirrorState, buf: SharedArrayBuffer): 'ok' | 'reallocated' | 'stale' {
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
  const drained = serialRing(buf).drain();
  if (drained.length > 0) {
    const text = textDecoder.decode(new Uint8Array(drained));
    if (text !== '') {
      state.serial.push(text);
      if (state.serial.length > SERIAL_CAP) state.serial.splice(0, state.serial.length - SERIAL_CAP);
    }
  }
}

/** Display bytes one bench part owns, matching the core writer order. */
function displayBytesForPart(definition: PartDefinition): number {
  const component = definition.component;
  if (component.kind === '7segment') return (component.digits ?? 1) + 1;
  if (component.kind === 'lcd') return LCD_TEXT_BYTES + 1;
  if (component.kind === 'servo') return 1;
  if (component.kind === 'neopixel' || component.kind === 'neopixel-matrix' || component.kind === 'led-ring') {
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
    for (let index = 0; index < 8; index++) segVolts.push(((pattern >> index) & 1) === 1 ? 0 : high);
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
      if (typeof tab === 'string' && tab !== '' && typeof line === 'number' && Number.isInteger(line) && line > 0) {
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

/** UI-read seam Bench uses (plain-data snapshots; TFT/map owned by Task 7). */
export interface WorkerClient {
  readonly controls: DynamicState;
  readonly running: boolean;
  start(): void;
  stop(): void;
  pinVoltages(): ReadonlyMap<string, number>;
  displaySnapshots(): ReadonlyMap<string, readonly number[]>;
  colonFlags(): ReadonlyMap<string, boolean>;
  serialLines(): readonly string[];
  setPressed(partId: string, pressed: boolean): void;
  setKnob(partId: string, spec: KnobSpec, value: number): void;
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
  readonly fault: string | null;
  readonly timeMs: number;
  readonly serialOverflow: boolean;
  dispose(): void;
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
  private faultText: string | null = null;
  private compileAbort: AbortController | null = null;
  private stagedHex: Uint16Array | null = null;
  private overflowSticky = false;
  private disposed = false;
  private pollTimes: number[] = [];
  private lastTimeMs = 0;

  constructor(board: PartDefinition, deps?: WorkerClientDeps) {
    this.boardDef = board;
    this.avrCompile = deps?.avrCompile ?? compileInWorker;
    this.avrProjectCompile = deps?.avrProjectCompile ?? compileProjectWithLibraries;
    this.depsIndexInstalled = deps?.indexInstalled;
    this.depsIndexBuild = deps?.indexBuild;
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
  }

  stop(): void {
    this.isRunning = false;
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

  serialLines(): readonly string[] {
    return [...this.mirror.serial];
  }

  setPressed(partId: string, pressed: boolean): void {
    this.controls.setPressed(partId, pressed);
    // Task 5 posts {press} on the port here; the local controls stay live
    // for render either way.
  }

  setKnob(partId: string, spec: KnobSpec, value: number): void {
    this.controls.setKnob(partId, spec, value);
    // Task 5 posts {knob} with the inline {spec, value} here.
  }

  loadFirmware(project: FirmwareProject): void {
    this.loadedFirmware = project;
    this.faultText = null;
    this.mirror.serial.length = 0;
    // Task 5 sends a rebuild (bench + firmware + execution) here.
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

    if (this.boardDef.id !== 'uno') {
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
    // Task 5 posts {flash, hex} here, reading the staged HEX.
    void this.stagedHex;
  }

  cancelCompile(): void {
    this.compileAbort?.abort();
  }

  sendBench(bench: Bench): void {
    this.bench = bench;
    // Task 5 posts the bench snapshot paired with the loaded firmware here;
    // the realloc reply carries the new SharedArrayBuffer into `live`.
    void this.loadedFirmware;
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
      this.pollTimes.push(now);
      while (this.pollTimes.length > 0 && now - (this.pollTimes[0] ?? now) > 1000) this.pollTimes.shift();
    }
    return outcome;
  }

  status(): WorkerStatus {
    return { backend: 'worker', fps: this.pollTimes.length, ratio: 0 };
  }

  dispose(): void {
    this.disposed = true;
    this.compileAbort?.abort();
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
        // Task 5 posts {flash, hex} here, reading the staged HEX.
        void this.stagedHex;
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
 * Builds the worker client, or null after `onFallback` when the worker path
 * cannot run: `forceNoWorker`, no `Worker` global, SHM construction throwing
 * (e.g. no isolation), or a version-handshake mismatch.
 */
export function createWorkerClient(opts: {
  board: PartDefinition;
  onFallback: (reason: string) => void;
  forceNoWorker?: boolean;
}): WorkerClient | null {
  const { board, onFallback, forceNoWorker } = opts;
  if (forceNoWorker === true) {
    onFallback('sim worker disabled (forceNoWorker)');
    return null;
  }
  if (typeof Worker === 'undefined') {
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
    onFallback(`sim worker unavailable: shared memory failed (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
  return new WorkerClientImpl(board);
}

export { WorkerClientImpl };
