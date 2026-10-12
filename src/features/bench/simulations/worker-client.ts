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
 * display bytes as a single `raw` entry; `WorkerClient` (which holds the last
 * bench sent on structural edits) remaps those into `${partId}:${pinId}`
 * volts and per-part value arrays. Serial drains accumulate UTF-8-decoded
 * text (capped like `Simulation`); the ring's sticky overflow flag is held by
 * the client and surfaced alongside `status()`.
 *
 * Transport scope: seven-segment patterns + colon, LCD text + flags, servo
 * angles, and pixel RGB — exactly what the core writes. Map tiles and TFT
 * framebuffers are OUT of scope (Task 7 owns tile injection + TFT transport;
 * no attempt here).
 *
 * Worker entry sequencing: Task 5 owns the worker entry + message contract.
 * Until it lands there is no port to handshake with, so `createWorkerClient`
 * runs the four specified fallback checks and then falls back with a
 * Task-5-pending reason rather than claiming a live worker. The `WorkerClient`
 * class below is the full seam Task 5 will drive (mirror remap, inputs,
 * bench snapshots, compile passthrough); Bench already branches on it, so no
 * Bench changes are needed when the entry lands beyond flipping the factory's
 * final return.
 *
 * Main-thread imports stay narrow: protocol views + plain types + the AVR
 * toolchain client (today's main-thread compile path) via the simulation
 * barrel. Never Engine/McuRuntime/AvrBackend/FirmwareRunner here.
 */

import {
  allocSnapshot,
  compileInWorker,
  displayView,
  headerView,
  layoutFor,
  netView,
  packageSketch,
  pinNodeView,
  serialRing,
  SNAP_MAGIC,
  SNAP_VERSION,
  type Bench,
  type FirmwareProject,
  type SnapshotLayout,
} from '@/features/simulation';
import { DynamicState, pixelCount, type KnobSpec, type PartDefinition } from '@/features/parts';

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
    a.netFloats === b.netFloats &&
    a.pinNodeUints === b.pinNodeUints &&
    a.displayBytes === b.displayBytes &&
    a.serialBytes === b.serialBytes
  );
}

/** Layout dims read back from the buffer alone via the protocol views. */
function dimsOf(buf: SharedArrayBuffer): SnapshotLayout {
  return {
    headerBytes: 64,
    netFloats: netView(buf).length,
    pinNodeUints: pinNodeView(buf).length,
    displayBytes: displayView(buf).length,
    serialBytes: serialRing(buf).capacity,
  };
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
function remapWithBench(state: MirrorState, bench: Bench): void {
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
  poll(): 'ok' | 'reallocated' | 'stale';
  status(): WorkerStatus;
  readonly fault: string | null;
  readonly timeMs: number;
  readonly netCount: number;
  readonly serialOverflow: boolean;
  dispose(): void;
}

class WorkerClientImpl implements WorkerClient {
  readonly controls = new DynamicState();
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
  private lastNetCount = 0;

  get running(): boolean {
    return this.isRunning;
  }

  get fault(): string | null {
    return this.faultText;
  }

  get timeMs(): number {
    return this.lastTimeMs;
  }

  get netCount(): number {
    return this.lastNetCount;
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

  async compileAndRun(project: FirmwareProject): Promise<void> {
    this.compileAbort?.abort();
    const controller = new AbortController();
    this.compileAbort = controller;
    // Today's main-thread worker path, then flash the HEX into the sim
    // worker by message (Task 5). Library multi-TU builds stay on the
    // in-page Simulation path until the entry lands; single-TU goes here.
    try {
      const packed = packageSketch(project);
      const compiled = await compileInWorker(
        packed.source,
        () => {},
        controller.signal,
      );
      if (this.compileAbort !== controller || controller.signal.aborted) return;
      this.compileAbort = null;
      this.stagedHex = compiled.hex;
      this.loadFirmware(project);
      // Task 5 posts {flash, hex} here, reading the staged HEX.
      void this.stagedHex;
    } catch (error) {
      if (this.compileAbort !== controller) return;
      this.compileAbort = null;
      if (controller.signal.aborted) {
        this.faultText = 'compile cancelled';
        return;
      }
      this.faultText = error instanceof Error ? error.message : String(error);
    }
  }

  cancelCompile(): void {
    this.compileAbort?.abort();
  }

  sendBench(bench: Bench): void {
    this.bench = bench;
    // Task 5 posts the bench snapshot paired with the loaded firmware here;
    // the realloc reply carries the new SharedArrayBuffer, which becomes
    // `live` below.
    void this.loadedFirmware;
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
      const layout = this.mirror.layout;
      if (layout !== null) this.lastNetCount = layout.netFloats;
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
}

/**
 * Builds the worker client, or null after `onFallback` when the worker path
 * cannot run: `forceNoWorker`, no `Worker` global, SHM construction throwing
 * (e.g. no isolation), or a version-handshake mismatch. The Task 5 entry is
 * still pending, so a fifth fallback (no port yet) applies today and is
 * reported as such; it flips to a live client without Bench changes.
 */
export function createWorkerClient(opts: {
  board: PartDefinition;
  onFallback: (reason: string) => void;
  forceNoWorker?: boolean;
}): WorkerClient | null {
  const { onFallback, forceNoWorker } = opts;
  void opts.board;
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
  // Task 5 wires the entry + handshake here and returns a live client.
  onFallback('sim worker pending: entry lands in Task 5, staying in-page');
  return null;
}

export { WorkerClientImpl };
