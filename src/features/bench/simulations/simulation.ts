/**
 * Deliberately a plain class rather than a hook. The bench holds a fully
 * populated breadboard of nearly a thousand terminals, and rebuilding that
 * through React state on every drag frame would be absurd; keeping the mutable
 * model here and letting React re-render from a version counter keeps the
 * expensive work out of the render path entirely.
 */

import {
  BenchBuilder,
  SNAP_DISTANCE_MM,
  type Bench,
  type BendPoint,
  type PartInstance,
  type Terminal,
  type WireEnd,
} from '@/features/simulation';
import {
  createScriptedI2c,
  createScriptedSampler,
  Engine,
  clearReportedFaults,
  loadScriptedRuntime,
  reportedFaults,
  type ScriptFault,
} from '@/features/simulation';
import { McuRuntime } from '@/features/simulation';
import { pythonModulesFor } from '@/features/simulation';
import { compile } from '@/features/simulation';
import { pinRefFor } from '@/features/simulation';
import type { CircuitDocument } from '@/features/simulation';
import {
  addPart as addPartToDoc,
  addWire as addWireToDoc,
  movePart as movePartInDoc,
  moveWireEnd as moveWireEndInDoc,
  removePart as removePartFromDoc,
  removeWire as removeWireFromDoc,
  rotatePart as rotatePartInDoc,
  setCapColour as setCapColourInDoc,
  setKnob as setKnobInDoc,
  setPartName as setPartNameInDoc,
  setWireBends as setWireBendsInDoc,
  setWireColour as setWireColourInDoc,
  type EditResult,
} from '@/features/simulation';
import {
  AvrBackend,
  hexForSourcesHash,
  parseIntelHex,
  sourcesHashForProject,
} from '@/features/simulation';
import {
  compileInWorker as builtinCompileInWorker,
  compileProjectWithLibraries as builtinCompileProjectWithLibraries,
  createProductionBackend,
  createProjectLibraryContext,
  lintPrototypes,
  packageSketch,
  restoreInstalledIndex,
  type CompileResult,
  type ProjectLibraryContext,
} from '@/features/simulation';
import type { DebugFrame, FirmwareDebugger } from '@/features/simulation';
import {
  FirmwareRunner,
  toSingleFileProject,
  type FirmwareLanguage,
  type FirmwareProject,
  type FirmwareServices,
  type I2cBusPins,
  type WirePort,
} from '@/features/simulation';
import { FirmwareSyntaxError, describeFirmwareError } from '@/features/simulation';
import { validateLibraries, libraryDeclarations, projectSlots } from '@/features/simulation';
import type { KnobSpec, PartDefinition, Rotation } from '@/features/parts';
import { nextAutomaticWireColour } from '../wiring/wire-colours';

import { GROUND } from '@/features/simulation';
import { DISTANCE_KNOB, echoMicroseconds } from '@/features/parts';
import { HUMIDITY_KNOB } from '@/features/parts';
import { DS18B20_TEMPERATURE_KNOB } from '@/features/parts';
import { pixelCount, type PixelColor } from '@/features/parts';
import { TEMPERATURE_KNOB } from '@/features/parts';
import type { DisplayController } from '@/features/parts';
import { Ili9341 } from '@/features/parts';
import { TileFetcher } from '../utils/map-fetcher';
import { TILE_SIZE, TileStore } from '../utils/map-tiles';
import { VirtualNetwork, createNetPort } from '@/features/simulation';
import type { MapPort } from '@/features/simulation';
import {
  createLiveFetcher,
  createTftPort,
  panelOnBus,
  type NetFetcher,
} from '@/features/simulation';
import { I2CBus } from '@/features/simulation';
import { SpiBus } from '@/features/simulation';
import { BusLog, type BusEntry } from '@/features/simulation';
import type { Servo } from '@/features/parts';
import type { Lcd1602 } from '@/features/parts';
import { LcdDriver, type LcdCommand } from '@/features/parts';

import type { TraceSample } from '@/features/simulation';
import {
  AMP_RANGES,
  OHM_RANGES,
  Multimeter,
  type AmpRange,
  type MeterMode,
  type MeterReading,
  type OhmRange,
} from '@/features/simulation';

import { DynamicState } from '@/features/parts';
import { routeWireViaCorners } from '../wiring/wire-route';
/** Longest slice of simulated time one rendered frame may cover. */
const MAX_FRAME_MS = 40;
/** Upper bound on generator steps per frame, so a runaway loop cannot hang. */
const MAX_SLICES_PER_FRAME = 400;

/**
 * Simulated time per second of wall-clock time, until the operator asks for
 * more. 1 keeps the bench running at the speed a person would actually
 * observe; `setTimeScale` raises it to watch a slow sketch without waiting
 * for it.
 */
const DEFAULT_TIME_SCALE = 1;

/**
 * The sketch the bench opens with: a blinking LED, a bar on the OLED over
 * I2C, and a bar on the TFT over SPI.
 */

/**
 * Real jumper colours, cycled so a populated board looks like a real one.
 *
 * The palette itself lives in `wire-colours`; this is only the automatic
 * assignment. Insulation colour carries no electrical meaning here, so it must
 * not imply any: the inspector reports the measured net, never a guess from the
 * wire.


/**
 * How many circuit states are kept. Beyond this the oldest falls off the end.
 *
 * Sixty is a lot of steps for a wiring bench and still only a few thousand
 * small records; the cap is there so an afternoon of nudging parts cannot grow
 * the history without bound.
 */
const HISTORY_LIMIT = 60;

/**
 * Where the breadboard sits on a fresh bench: clear of the board plugged in
 * beside it. Every bench the app builds agrees on this number, because a hole
 * is a coordinate and two benches that disagree cannot share a circuit.
 */
export const BREADBOARD_ORIGIN_X = 230;

/**
 * A continuous edit in progress: a drag.
 *
 * The document is authoritative between gestures. During one, the bench is
 * mutated in place and nothing is compiled -- a drag holds the terminal objects
 * it started with, and a recompile renumbers them -- and the gesture's final
 * state is written to the document as one operation on release, which is also
 * why one drag is one undo step.
 */
type Gesture =
  | { readonly kind: 'part-move'; readonly id: string }
  | { readonly kind: 'wire-bends'; readonly id: string }
  | { readonly kind: 'wire-end'; readonly id: string; readonly end: WireEnd };

/**
 * Reason text out of a worker rejection: an `Error`'s message, a
 * `CompileError`'s located message, or the thrown value stringified.
 *
 * A located rejection (non-empty `tab`, positive `line`) keeps its origin up
 * front as `tab:line: message` — the same `file:line` shape the interpreter
 * reports — so the editor can open the right tab, including a library slot
 * file. Unlocated rejections read exactly as before.
 */
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
 * Where a worker compile stands. A plain public field, read the way Bench
 * already reads `firmwareError`: after `await compileAndRun` it holds the
 * verdict, and while the worker runs it holds `'compiling'`.
 */
export type CompileState = 'idle' | 'compiling' | 'ready' | { error: string };

/**
 * Whether a project builds through the multi-TU library path: any declared
 * libraries (provided Tier-2 entries or custom refs), or custom slots
 * carrying files. Everything else keeps the exact single-TU path.
 */
function hasLibraryBuild(project: FirmwareProject): boolean {
  if (libraryDeclarations(project).length > 0) return true;
  return projectSlots(project).some((slot) => slot.files.length > 0);
}

/**
 * Seam for the worker compile client. Production uses the real in-worker
 * client; tests inject a stub that counts calls, rejects, or hangs until
 * abort — the same way the class already wraps its `I2CBus`/`SpiBus`
 * instances rather than reaching for a global.
 */
export interface SimulationDeps {
  readonly avrCompile?: typeof builtinCompileInWorker;
  readonly avrProjectCompile?: typeof builtinCompileProjectWithLibraries;
  /** Installed index entries for validation; absent falls back to the IDB object cache. */
  readonly indexInstalled?: ProjectLibraryContext['indexInstalled'];
  /** Installed-index object builds; absent uses the production index build. */
  readonly indexBuild?: ProjectLibraryContext['index'];
  /**
   * Whether the bench's network may bridge to real hosts (`net/bridge.ts`).
   *
   * Set from the build's data (`GalleryBuild.network === 'live'`) and never
   * from a link: a fetch is a decision about the machine the bench runs on, and
   * a pasted circuit is someone else's text.
   */
  readonly liveNetwork?: boolean;
  /** Test seam: the fetcher a bridge uses instead of the browser's own. */
  readonly liveFetcher?: NetFetcher;
}

export class Simulation {
  readonly builder = new BenchBuilder();
  readonly mcu: McuRuntime;
  readonly engine: Engine;

  runner: FirmwareRunner | null = null;
  /**
   * The debugger watching this run, when there is one.
   *
   * It is kept across sketch loads, so the stops a person set are still set
   * when they press Run again.
   */
  private debugger: FirmwareDebugger | null = null;
  firmwareError: string | null = null;
  compileState: CompileState = 'idle';
  serial: string[] = [];
  running = false;

  /** What the operator is doing to the parts, shared with the renderers. */
  readonly controls = new DynamicState();
  private firmwareSource = '';
  private firmwareProject: FirmwareProject | null = null;
  /** Which grammar the loaded source is written in. */
  firmwareLanguage: FirmwareLanguage = 'arduino-cpp';
  /**
   * Which backend runs loaded firmware. `'avr'` needs a Uno board and a
   * committed HEX whose staged sources hash to the loaded project; anything
   * missing falls back to `'interpreter'` silently. Leaving `'avr'` waits
   * for the next `loadFirmware`, which is where the HEX is matched and
   * flashed; returning to `'interpreter'` drops a live AVR core at once.
   */
  private executionMode: 'interpreter' | 'avr' = 'interpreter';
  get execution(): 'interpreter' | 'avr' {
    return this.executionMode;
  }
  set execution(mode: 'interpreter' | 'avr') {
    this.executionMode = mode;
    // The interpreter runner below was never stepped while the AVR core owned
    // the frame, so it resumes pristine.
    if (mode === 'interpreter') this.avrBackend = null;
  }
  /** Live AVR core while execution is `'avr'` with a flashed HEX; null otherwise. */
  private avrBackend: AvrBackend | null = null;
  /**
   * MCU revision at the last AVR PIN-read settle. Reads settle once after a
   * pin-intent change (pinMode, reset) so the boot transient cannot read LOW
   * before setup's pull-ups solve; steady polling never settles here.
   */
  private avrSettledRevision = -1;
  private readonly avrCompile: typeof builtinCompileInWorker;
  private readonly avrProjectCompile: typeof builtinCompileProjectWithLibraries;
  private readonly indexInstalled: ProjectLibraryContext['indexInstalled'];
  private readonly indexBuild: ProjectLibraryContext['index'];
  /** In-flight worker build, so a new `compileAndRun` aborts the previous. */
  private compileAbort: AbortController | null = null;
  private serialSnapshot: string[] = [];

  /**
   * Board pins the logic analyser is watching.
   *
   * Held as ids rather than nets because a net is only known once the bench
   * settles, and the operator picks pins before anything moves.
   */
  private analysedPins: string[] = [];
  private readonly busLog = new BusLog();

  private serialDirty = true;

  private scriptedStart: Promise<void> | null = null;

  /**
   * The scripting half, loading on first ask.
   *
   * Lazy on purpose: the runtime is 492 KB of QuickJS behind a dynamic import,
   * so a bench with no scripted parts must never fetch it -- and every test that
   * builds a bench is such a bench. The promise is the signal to wait on
   * (nothing here sleeps); it is already resolved when no part needs one.
   */
  async scriptedReady(): Promise<void> {
    if (!this.bench.parts.some((part) => part.definition.script !== undefined)) return;
    this.scriptedStart ??= this.startScriptedRuntime();
    await this.scriptedStart;
  }

  /**
   * Starts the scripting half. The runtime is owned by the sampler's closure,
   * which lives as long as the engine does; a page navigation is what frees it,
   * exactly as it frees the bench.
   */
  private async startScriptedRuntime(): Promise<void> {
    const runtime = await loadScriptedRuntime();
    this.engine.setScriptedSampler(createScriptedSampler(runtime, () => this.bench.parts));
    this.engine.setScriptedI2c(createScriptedI2c(runtime, () => this.bench.parts));
  }

  constructor(board: PartDefinition, deps?: SimulationDeps) {
    this.mcu = new McuRuntime(board);
    this.engine = new Engine({
      bench: this.builder.build(),
      mcu: this.mcu,
      dynamicState: this.controls,
    });
    /*
     * Assigned after the engine because the clock is read from it. A bridge is
     * installed only when the build asked for one, so the default bench cannot
     * reach a real host by accident.
     */
    this.net = new VirtualNetwork(() => this.engine.timeMs, {
      fetch: deps?.liveFetcher ?? (deps?.liveNetwork ? createLiveFetcher() : undefined),
    });
    this.avrCompile = deps?.avrCompile ?? builtinCompileInWorker;
    this.avrProjectCompile = deps?.avrProjectCompile ?? builtinCompileProjectWithLibraries;
    this.indexInstalled = deps?.indexInstalled;
    this.indexBuild = deps?.indexBuild;
  }
  get bench(): Bench {
    return this.builder.build();
  }

  private doc: CircuitDocument = { version: 1, parts: [], wires: [] };
  /** The drag in progress, if any: the bench is authoritative until it ends. */
  private gesture: Gesture | null = null;
  /** The document a gesture started from, which its undo entry restores. */
  private gestureStart: CircuitDocument | null = null;

  /**
   * The circuit's structure, which is the source of truth.
   *
   * Edits are operations over this value; the bench above is compiled from it
   * after every one. It is immutable by convention -- `circuit-edit` returns a
   * new document rather than changing one -- so a history entry is just a
   * reference to a previous value, and nothing can edit the projection into a
   * state the document could not represent.
   */
  get document(): CircuitDocument {
    return this.doc;
  }

  /**
   * Makes `doc` the live structure and recompiles the bench from it.
   *
   * A refusal is a bug in the edit layer, not operator input: the previous
   * projection is kept and the reason goes to the console, because a
   * half-built bench would be worse than the one the operator is looking at.
   */
  private applyDocument(doc: CircuitDocument): boolean {
    const { bench, snapshot, errors } = compile(doc);
    if (errors.length > 0 || bench === null || snapshot === null) {
      console.warn(`circuit edit refused: ${errors.join('; ')}`);
      return false;
    }
    this.doc = doc;
    this.builder.restore(snapshot);
    this.rebuild();
    return true;
  }

  /** Applies one document operation, as one undoable step. */
  private edit(operation: (doc: CircuitDocument) => EditResult): void {
    const result = operation(this.doc);
    if (result.error !== undefined) {
      console.warn(`circuit edit refused: ${result.error}`);
      return;
    }
    const before = this.doc;
    if (!this.applyDocument(result.doc)) return;
    this.pushUndo(before);
  }

  private pushUndo(before: CircuitDocument): void {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    // Anything that was undone can no longer be redone: the future it pointed
    // at has just been edited away.
    this.redoStack.length = 0;
  }

  /*
   * Undo history, as circuit states.
   *
   * Documents rather than bench snapshots: the document is the state, so an
   * entry is a reference to a previous value. The old snapshot model travelled
   * with the bench's id counters; ids now live in the document, so an undo that
   * re-places a part still hands out the same serial for it.
   */
  private undoStack: CircuitDocument[] = [];
  private redoStack: CircuitDocument[] = [];

  /**
   * Opens a drag. The bench is mutated in place until `endGesture`, so the
   * terminals the gesture holds stay valid and no compile runs per frame.
   */
  beginGesture(kind: Gesture['kind'], id: string, end?: WireEnd): void {
    if (this.gesture !== null) return;
    this.gestureStart = this.doc;
    this.gesture =
      kind === 'wire-end'
        ? { kind, id, end: end ?? 'to' }
        : kind === 'part-move'
          ? { kind, id }
          : { kind: 'wire-bends', id };
  }

  /**
   * Closes the drag and writes what it did as one document operation.
   *
   * A drag that ends on a loose contact -- a wire end between pins -- cannot be
   * expressed by a document, so it springs back to the pin it was last on: the
   * bench is recomputed from the unchanged document.
   */
  endGesture(): void {
    const gesture = this.gesture;
    const before = this.gestureStart;
    this.gesture = null;
    this.gestureStart = null;
    if (gesture === null || before === null) return;

    const operation = (doc: CircuitDocument): EditResult | null => {
      if (gesture.kind === 'part-move') {
        const part = this.bench.parts.find((candidate) => candidate.id === gesture.id);
        const current = doc.parts.find((candidate) => candidate.id === gesture.id);
        if (!part || !current) return null;
        if (current.x === part.x && current.y === part.y) return null;
        return movePartInDoc(doc, part.id, part.x, part.y);
      }
      if (gesture.kind === 'wire-bends') {
        const wire = this.bench.wires.find((candidate) => candidate.id === gesture.id);
        const current = doc.wires.find((candidate) => candidate.id === gesture.id);
        if (!wire || !current) return null;
        const same =
          wire.bends.length === current.bends.length &&
          wire.bends.every(
            (bend, index) =>
              bend.x === current.bends[index]?.x && bend.y === current.bends[index]?.y,
          );
        if (same) return null;
        return setWireBendsInDoc(doc, wire.id, wire.bends);
      }
      const wire = this.bench.wires.find((candidate) => candidate.id === gesture.id);
      if (!wire) return null;
      const endTerminal = this.bench.terminals[gesture.end === 'from' ? wire.from : wire.to];
      const ref = endTerminal ? this.pinRefAt(endTerminal) : null;
      if (ref === null) return null;
      const current = doc.wires.find((candidate) => candidate.id === gesture.id);
      if (!current || (gesture.end === 'from' ? current.from : current.to) === ref) return null;
      return moveWireEndInDoc(doc, wire.id, gesture.end, ref);
    };

    const next = operation(before);
    if (next === null) {
      // Nothing changed, or the end cannot be represented: recompute from the
      // document either way, so a loose end springs back to its last pin.
      this.applyDocument(before);
      return;
    }
    if (next.error !== undefined) {
      console.warn(`circuit edit refused: ${next.error}`);
      this.applyDocument(before);
      return;
    }
    if (!this.applyDocument(next.doc)) return;
    this.pushUndo(before);
  }

  /**
   * The `partId:pin` reference a terminal belongs to, or null for a loose
   * contact.
   *
   * A terminal with an owner answers directly; anything else is snapped to the
   * nearest terminal within `SNAP_DISTANCE_MM`, which is the same rule the
   * builder applies when it decides which contact a wire lands on -- a
   * coordinate-only endpoint (a pointer between holes, a test's synthetic
   * terminal) resolves exactly as the drawn wire would.
   *
   * The first owner in part order decides when several parts share a contact,
   * which is the rule the decompiler uses: a breadboard hole under a lead has
   * one answer and it is the same answer on every pass.
   */
  private pinRefAt(terminal: Terminal): string | null {
    const direct = this.ownerOf(terminal.id);
    if (direct !== null) return direct;
    let nearest: { id: number; distance: number } | null = null;
    for (const candidate of this.bench.terminals) {
      const distance = Math.hypot(candidate.x - terminal.x, candidate.y - terminal.y);
      if (distance > SNAP_DISTANCE_MM) continue;
      if (nearest === null || distance < nearest.distance) {
        nearest = { id: candidate.id, distance };
      }
    }
    return nearest === null ? null : this.ownerOf(nearest.id);
  }

  /** The pin that owns a terminal, if any part claims it. */
  private ownerOf(terminalId: number): string | null {
    for (const part of this.bench.parts) {
      for (const [pinId, candidate] of Object.entries(part.terminals)) {
        if (candidate === terminalId) return `${part.id}:${pinRefFor(part.definition, pinId)}`;
      }
    }
    return null;
  }

  /**
   * Forgets the history.
   *
   * A circuit that has just been seeded -- a project's parts and jumpers going
   * down, a circuit arriving from a link or a file -- is a starting point, not a
   * list of edits, and it must not be undone wire by wire.
   *
   * An example is the exception, deliberately: it replaces the bench *and*
   * records one entry (`replaceCircuit`), because the operator may well want the
   * circuit they had back.
   */
  clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.gesture = null;
    this.gestureStart = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Steps the circuit back one edit. Returns whether there was one to step to. */
  undo(): boolean {
    const previous = this.undoStack.pop();
    if (previous === undefined) return false;
    const current = this.doc;
    if (!this.applyDocument(previous)) {
      this.undoStack.push(previous);
      return false;
    }
    this.redoStack.push(current);
    return true;
  }

  /** Steps the circuit forward again. Returns whether there was one to step to. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    const current = this.doc;
    if (!this.applyDocument(next)) {
      this.redoStack.push(next);
      return false;
    }
    this.undoStack.push(current);
    return true;
  }

  /** Loads firmware, reporting a syntax error instead of throwing at the UI. */
  loadFirmware(
    source: string | FirmwareProject,
    language: FirmwareLanguage = this.firmwareLanguage,
  ): void {
    const project = typeof source === 'string' ? toSingleFileProject(source, language) : source;
    this.firmwareProject = project;
    this.firmwareSource = project.files.find((f) => f.name === project.activeName)?.content ?? '';
    this.firmwareLanguage = project.language;
    this.serial = [];
    this.serialDirty = true;
    this.engine.timeMs = 0;
    this.mcu.reset();
    // A fresh sketch owes nothing: without this, the previous sketch's
    // in-flight delay would gate the new one, which reads as a hang.
    this.pendingDelayMs = 0;

    try {
      this.runner = new FirmwareRunner(project, this.services(), project.language);
      this.runner.runtime.attachDebugger(this.debugger);
      this.firmwareError = null;
    } catch (error) {
      this.runner = null;
      this.firmwareError =
        error instanceof FirmwareSyntaxError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
    }
    // An AVR run needs a flashed core on top of the interpreter runner above;
    // anything missing falls back to that runner silently.
    this.avrBackend = null;
    if (this.executionMode === 'avr') this.tryFlashAvr();
    this.rebuild();
  }

  /**
   * Flashes the committed HEX matching the loaded project onto an AVR core.
   *
   * Gated twice: only a Uno board can run it, and only a HEX whose staged
   * sources hash to this exact project applies — a stale HEX falls back
   * rather than running yesterday's firmware. A parse or construction failure
   * reports through `firmwareError` while the interpreter runner above keeps
   * the bench alive.
   */
  private tryFlashAvr(): void {
    try {
      if (this.mcu.board.id !== 'uno') return;
      const project = this.firmwareProject;
      if (!project) return;
      const hexText = hexForSourcesHash(sourcesHashForProject(project));
      if (hexText === null) return;
      this.flashAvrWords(parseIntelHex(hexText));
    } catch (error) {
      this.avrBackend = null;
      this.firmwareError = error instanceof Error ? error.message : String(error);
    }
  }

  /** Builds an AVR core from flash words over the same hooks `tryFlashAvr` uses. */
  private flashAvrWords(program: Uint16Array): void {
    const flashed = new AvrBackend(program, {
      mcu: this.mcu,
      nowMs: () => this.engine.timeMs,
      onEdge: (gpio, cycles, high) => this.engine.recordGpioEdge(gpio, cycles, high),
      readPin: (gpio) => {
        // PIN reads observe the last scheduled solve (1-4ms cadence via
        // onSettle), except after a pin-intent change (pinMode, reset): the
        // cached solve predates the new intents, so the first read after the
        // change settles once. Without that, the boot transient reads LOW
        // before setup's pull-ups solve, and the alarm library boots toggled.
        // Steady polling never settles here: ~1200 solves per frame for state
        // that cannot have meaningfully moved (button debounce alone is
        // 25ms+). TWI/USART read from their models, never the circuit.
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
  }

  /**
   * Compiles a project in the worker and runs it on the AVR core, falling
   * back rather than leaving the bench dark.
   *
   * The chain: non-Uno boards are refused before the worker is even touched
   * (the interpreter runs the sketch instead); lint hints are notices and
   * never block; a worker success flashes the fresh HEX; a worker, build, or
   * parse failure runs the bundled HEX when its sources hash is fresh for
   * this exact project, else the interpreter; a cancelled build flashes
   * nothing. Every branch lands `compileState` and `firmwareError` with its
   * own message. Never rejects: failures report through those fields, the
   * way `loadFirmware` reports syntax errors. A new call aborts the previous
   * build via the stored controller.
   */
  /**
   * Aborts the in-flight worker build, if any. The awaiting `compileAndRun`
   * lands `'compile cancelled'` and flashes nothing.
   */
  cancelCompile(): void {
    this.compileAbort?.abort();
  }
  async compileAndRun(project: FirmwareProject): Promise<void> {
    this.compileAbort?.abort();
    const controller = new AbortController();
    this.compileAbort = controller;
    const signal = controller.signal;

    if (this.mcu.board.id !== 'uno') {
      this.loadFirmware(project);
      this.firmwareError = 'AVR backend needs an Uno board';
      this.compileState = { error: 'AVR backend needs an Uno board' };
      if (this.compileAbort === controller) this.compileAbort = null;
      return;
    }

    const slots = projectSlots(project);
    // Restoring suspends, so projects without index declarations skip it
    // entirely: the compile below must be reached synchronously, the way an
    // abort between Run and the worker call expects.
    const wantsIndex = libraryDeclarations(project).some((entry) => entry.source === 'index');
    const indexInstalled =
      this.indexInstalled ?? (wantsIndex ? await this.restoreIndexInstalled(project) : undefined);
    const declarationErrors = validateLibraries(project, { slots, indexInstalled });
    if (declarationErrors.length > 0) {
      // Offline-friendly: no worker traffic, straight to the interpreter fallback.
      this.loadFirmware(project);
      const reason = `declared libraries invalid: ${declarationErrors.join('; ')}`;
      this.firmwareError = reason;
      this.compileState = { error: reason };
      if (this.compileAbort === controller) this.compileAbort = null;
      return;
    }

    // Lint hints stay notices: the IDE auto-prototypes, so a flagged call
    // still compiles — this only informs, it never blocks the worker.
    lintPrototypes(packageSketch(project).source);

    const packed = packageSketch(project);
    this.compileState = 'compiling';
    let compiled: CompileResult;
    try {
      if (hasLibraryBuild(project)) {
        // Declared libraries build across translation units: the firmware TU
        // plus library TUs linked with prebuilt Tier-2 objects. Same result
        // shape and same landing as the single-TU path below.
        compiled = await this.avrProjectCompile(
          project,
          {
            ...createProjectLibraryContext(slots, { indexInstalled }),
            ...(this.indexBuild !== undefined ? { index: this.indexBuild } : {}),
          },
          () => {
            this.compileState = 'compiling';
          },
          signal,
        );
      } else {
        compiled = await this.avrCompile(
          packed.source,
          () => {
            this.compileState = 'compiling';
          },
          signal,
        );
      }
    } catch (error) {
      // A newer build owns the verdict now; the stale one stays silent.
      if (this.compileAbort !== controller) return;
      this.compileAbort = null;
      if (signal.aborted) {
        this.firmwareError = 'compile cancelled';
        this.compileState = { error: 'compile cancelled' };
        return;
      }
      this.landCompileFailure(project, compileDetail(error));
      return;
    }

    if (this.compileAbort !== controller || signal.aborted) {
      // Superseded by a newer build, or aborted while awaiting: a stale
      // success must not overwrite the newer run, and a cancelled build
      // flashes nothing.
      if (signal.aborted && this.compileAbort === controller) {
        this.compileAbort = null;
        this.firmwareError = 'compile cancelled';
        this.compileState = { error: 'compile cancelled' };
      }
      return;
    }
    this.compileAbort = null;
    // The fresh HEX wins: rebuild the interpreter base, then overlay the
    // core, so serial, timing, and the runner start from t=0 together.
    this.loadFirmware(project);
    try {
      this.flashAvrWords(compiled.hex);
    } catch (error) {
      this.landCompileFailure(project, compileDetail(error));
      return;
    }
    this.firmwareError = null;
    this.compileState = 'ready';
  }

  /**
   * Rebuilds the installed-index map from the versioned IDB object cache,
   * which outlives the session: declarations persist with the project while
   * the session map does not, so a reload would otherwise fail validation as
   * `unknown index library` until reinstall. Projects without index
   * declarations skip the backend entirely; any cache failure restores empty
   * (the validation reason names the library, never a cache detail), and an
   * injected map always wins over the restore.
   */
  private async restoreIndexInstalled(
    project: FirmwareProject,
  ): Promise<ReadonlyMap<string, { headers: readonly string[] }> | undefined> {
    const wanted = libraryDeclarations(project).filter((entry) => entry.source === 'index');
    if (wanted.length === 0) return undefined;
    try {
      return await restoreInstalledIndex(wanted, createProductionBackend());
    } catch {
      return new Map();
    }
  }

  /**
   * Worker/build/parse failure landing: the bundled HEX when its staged
   * sources hash to this exact project, else the interpreter. `loadFirmware`
   * always re-establishes the interpreter runner; the bundled branch overlays
   * its core on top, the interpreter branch pins `avrBackend` to null.
   */
  private landCompileFailure(project: FirmwareProject, detail: string): void {
    const bundled = hexForSourcesHash(sourcesHashForProject(project));
    if (bundled !== null) {
      try {
        const program = parseIntelHex(bundled);
        this.loadFirmware(project);
        this.flashAvrWords(program);
        const message = `compile failed, running bundled HEX: ${detail}`;
        this.firmwareError = message;
        this.compileState = { error: message };
        return;
      } catch {
        // A corrupt committed HEX falls through to the interpreter below.
      }
    }
    this.loadFirmware(project);
    this.avrBackend = null;
    const message = detail.includes('compile failed') ? detail : `compile failed: ${detail}`;
    this.firmwareError = message;
    this.compileState = { error: message };
  }

  /**
   * The AVR core's I2C sink: each byte still goes to the engine (which
   * decides the ACK and moves device state), and is also staged through
   * the shared I2CBus so the closing writeEnd records the transfer in
   * the bus log exactly like the interpreter path. Reads stay
   * engine-direct.
   */
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
    // Cap the buffer so a chatty sketch cannot grow it without limit.
    if (this.serial.length > 400) this.serial.splice(0, this.serial.length - 400);
    this.serialDirty = true;
  }

  start(): void {
    // A flashed AVR core counts as a loaded runner: a sketch with shapes the
    // interpreter cannot parse still runs from the HEX, so reloading here
    // would discard the fresh core for a syntax error and leave the bench
    // dark. Only reload when neither runner exists.
    if (!this.runner && !this.avrBackend && this.firmwareProject)
      this.loadFirmware(this.firmwareProject);
    this.running = true;
  }

  /**
   * Watches this run with a debugger, or stops watching with null.
   *
   * The watcher is kept, so a sketch loaded later is watched too: the stops
   * a person set belong to the sketch, not to the run that happened to be
   * going when they set them.
   */
  attachDebugger(watcher: FirmwareDebugger | null): void {
    this.debugger = watcher;
    this.runner?.runtime.attachDebugger(watcher);
  }

  /**
   * The frame the program stopped on, while the debugger holds it.
   *
   * Null while the program is running, and null again once it carries on --
   * a frame is where the program *is*, not where it was.
   */
  debugFrame(): DebugFrame | null {
    return this.runner?.stoppedAt ?? null;
  }

  /** Whether the debugger has the program stopped. */
  get debugPaused(): boolean {
    return this.runner?.paused === true;
  }

  /**
   * Lets the program carry on from where the debugger stopped it.
   *
   * The statement the debugger stopped at runs then: a stop is before the
   * statement, not on it.
   */
  resumeDebug(): void {
    this.runner?.resume();
  }

  /**
   * Runs the program to the next statement at the level it is at.
   *
   * A call is stepped over rather than into, so the next statement is the
   * one after the call and not the one inside it.
   */
  stepDebugOver(): void {
    const frame = this.debugFrame();
    if (frame === null) return;
    this.debugger?.stepOver(frame.depth);
    this.runner?.resume();
  }

  /** Runs the program to the very next statement, whatever level it is at. */
  stepDebugInto(): void {
    this.debugger?.stepInto();
    this.runner?.resume();
  }

  /** Simulated milliseconds per wall-clock millisecond; 1 is real time. */
  private timeScale = DEFAULT_TIME_SCALE;

  /**
   * Sets how much simulated time each wall-clock millisecond buys: 1 is real
   * time, 2 is fast forward. Takes effect on the next frame, mid-run
   * included; a single frame's slice stays capped, so this changes how fast
   * the sketch gets there, never how a `delay` is spent.
   */
  setTimeScale(scale: number): void {
    this.timeScale = Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_TIME_SCALE;
  }

  private probedPinId: string | null = null;

  /**
   * Moves the scope probe onto a board pin, or lifts it with null.
   *
   * Watching follows the *net* the pin sits on, so probing a pin wired to
   * something interesting shows that thing's voltage -- and probing one wired
   * to nothing shows nothing, exactly as a real probe would.
   */
  setProbePin(pinId: string | null): void {
    if (this.probedPinId) {
      this.engine.probes.unwatch(this.engine.netOfMcuPin(this.probedPinId));
    }
    if (pinId) this.engine.probes.watch(this.engine.netOfMcuPin(pinId));
    this.probedPinId = pinId;
  }

  get probePinId(): string | null {
    return this.probedPinId;
  }

  /** Captured samples on the probed net, oldest first. */
  probeTrace(): TraceSample[] {
    if (!this.probedPinId) return [];
    return this.engine.probes.waveform(this.engine.netOfMcuPin(this.probedPinId))?.toArray() ?? [];
  }

  /**
   * Clips the multimeter onto two board pins, or lifts it with nulls.
   *
   * Pins rather than nets, because a net is an index into the circuit the last
   * rebuild produced: replace the bench -- a document, a link, a file, an
   * example -- and the numbering changes underneath, leaving a stored index
   * meaning some unrelated net. The reading would look alive and be of
   * something else. A pin keeps its meaning, so the probes are resolved from
   * them on every rebuild.
   */
  setMeterProbes(redPinId: string | null, blackPinId: string | null): void {
    this.meterPinIds = { red: redPinId, black: blackPinId };
    this.resolveMeterProbes();
    this.engine.settle();
  }

  /**
   * Re-binds the meter's nets to the pins it is clipped to.
   *
   * Called on every rebuild, which is what keeps a reading honest across a
   * rewiring: the nets it refers to are the ones the pins have now.
   */
  private resolveMeterProbes(): void {
    const netOf = (pinId: string | null) =>
      pinId === null ? GROUND : this.engine.netOfMcuPin(pinId);
    this.meter.setProbes(netOf(this.meterPinIds.red), netOf(this.meterPinIds.black));
    this.engine.setMeter(this.meter);
  }

  private meterPinIds: { red: string | null; black: string | null } = { red: null, black: null };

  get meterMode(): MeterMode {
    return this.meter.mode;
  }

  setMeterMode(mode: MeterMode): void {
    this.meter.mode = mode;
    // Mode changes the meter's stamp: invalidate the solve cache first.
    this.engine.touch();
    this.engine.settle();
  }

  setMeterRange(rangeId: string): void {
    const found =
      this.meter.mode === 'amps'
        ? AMP_RANGES.find((range) => range.id === rangeId)
        : OHM_RANGES.find((range) => range.id === rangeId);
    if (!found) return;
    if (this.meter.mode === 'amps') this.meter.ampRange = found as AmpRange;
    else this.meter.ohmRange = found as OhmRange;
    // Range changes the meter's stamp: invalidate the solve cache first.
    this.engine.touch();
    this.engine.settle();
  }

  get meterRangeId(): string {
    return this.meter.mode === 'amps' ? this.meter.ampRange.id : this.meter.ohmRange.id;
  }

  /** What the meter's display would currently show. */
  meterReading(): MeterReading {
    return this.meter.read((net) => this.engine.voltageOfNet(net));
  }

  private readonly meter = new Multimeter();

  stop(): void {
    this.running = false;
  }

  /**
   * Whether the picture is expected to change from here on.
   *
   * The bench re-renders on every frame the simulation is moving and not
   * otherwise. That distinction is the whole cost of the render loop: a bench
   * at rest draws an identical tree, and drawing it sixty times a second is
   * what starved a route change into taking tens of seconds.
   *
   * Anything that changes the bench without ticking -- wiring a part, picking
   * an example, pressing Run -- asks for its own render, so nothing here has
   * to know about it.
   */
  isAnimating(): boolean {
    return this.running;
  }

  /** Rebuilds the circuit and restarts firmware from t=0. */
  reset(): void {
    // A reset is the operator's retry: the last run's script rows are gone.
    clearReportedFaults();
    this.engine.timeMs = 0;
    this.mcu.reset();
    this.serial = [];
    this.runner = null;
    this.loadFirmware(this.firmwareProject ?? this.firmwareSource);
  }

  movePart(partId: string, x: number, y: number): void {
    if (this.gesture?.kind === 'part-move') {
      // Mid-drag: the bench is authoritative and nothing may renumber the
      // terminals the gesture holds. `endGesture` writes this as one step.
      this.builder.movePart(partId, x, y);
      this.rebuild();
      return;
    }
    this.edit((doc) => movePartInDoc(doc, partId, x, y));
  }

  /**
   * Routes a jumper, in the colour the operator has chosen.
   *
   * The chosen colour is passed in rather than read from here, so the picker in
   * the header and the wire it places cannot disagree about what colour "next"
   * means.
   *
   * Both ends have to be pins: a dangling end cannot be expressed by a
   * document (saving used to drop it with a warning) and is refused here
   * instead of being drawn and then lost.
   */
  routeWire(from: Terminal, to: Terminal, bends: readonly BendPoint[] = [], colour?: string): void {
    const start = this.pinRefAt(from);
    const end = this.pinRefAt(to);
    if (start === null || end === null) {
      console.warn('a wire ends on a pin; a loose contact cannot be saved');
      return;
    }
    this.edit((doc) =>
      addWireToDoc(doc, start, end, {
        colour: colour ?? nextAutomaticWireColour(this.bench.wires.length),
        gaugeAwg: 26,
        bends,
      }),
    );
  }

  /**
   * Re-clips one end of a placed jumper, the way Wokwi lets a wire be dragged.
   *
   * Re-solved because this is an electrical change: the wire now joins whatever
   * its two ends are, so every net it touched before may be different.
   */
  moveWireEnd(wireId: string, end: WireEnd, to: Terminal): void {
    if (this.gesture?.kind === 'wire-end') {
      // Mid-drag: the wire follows the pointer in the projection, and
      // `endGesture` commits wherever it ended up -- or springs it back if
      // that is not a pin.
      this.builder.moveWireEnd(wireId, end, to.x, to.y);
      this.rebuild();
      return;
    }
    const ref = this.pinRefAt(to);
    if (ref === null) {
      console.warn('a wire ends on a pin; a loose contact cannot be saved');
      return;
    }
    this.edit((doc) => moveWireEndInDoc(doc, wireId, end, ref));
  }

  /**
   * Takes a jumper off the bench.
   *
   * Re-solved because removing a wire opens whatever net it was the only link
   * in -- which is the point: pulling a jumper is how an operator disconnects
   * two things.
   */
  removeWire(wireId: string): void {
    this.edit((doc) => removeWireFromDoc(doc, wireId));
  }

  /**
   * Recolours a placed jumper.
   *
   * Deliberately no re-solve: insulation carries no electrical meaning, so
   * nothing downstream can see this change and solving again would cost a full
   * circuit pass to produce the same answer.
   */
  setWireColour(wireId: string, colour: string): void {
    const result = setWireColourInDoc(this.doc, wireId, colour);
    if (result.error !== undefined) {
      console.warn(`circuit edit refused: ${result.error}`);
      return;
    }
    const before = this.doc;
    this.doc = result.doc;
    this.builder.setWireColour(wireId, colour);
    this.pushUndo(before);
  }

  /** Reshapes a placed jumper, re-measuring and re-solving it. */
  setWireBends(wireId: string, bends: readonly BendPoint[]): void {
    if (this.gesture?.kind === 'wire-bends') {
      this.builder.setWireBends(wireId, bends);
      this.rebuild();
      return;
    }
    this.edit((doc) => setWireBendsInDoc(doc, wireId, bends));
  }

  removeWireBend(wireId: string, index: number): void {
    if (this.gesture?.kind === 'wire-bends') {
      this.builder.removeWireBend(wireId, index);
      this.rebuild();
      return;
    }
    const wire = this.doc.wires.find((candidate) => candidate.id === wireId);
    if (!wire) return;
    const bends = wire.bends.filter((_, at) => at !== index);
    this.edit((doc) => setWireBendsInDoc(doc, wireId, bends));
  }

  insertWireBend(wireId: string, index: number, bend: BendPoint): void {
    if (this.gesture?.kind === 'wire-bends') {
      this.builder.insertWireBend(wireId, index, bend);
      this.rebuild();
      return;
    }
    const wire = this.doc.wires.find((candidate) => candidate.id === wireId);
    if (!wire) return;
    const bends = [...wire.bends];
    bends.splice(index, 0, bend);
    this.edit((doc) => setWireBendsInDoc(doc, wireId, bends));
  }

  /**
   * Where a new waypoint belongs, as an index into the wire's *bends*.
   *
   * The two index spaces are different lengths and confusing them is the bug
   * this shape exists to prevent. `routeWireViaCorners` returns every corner the
   * wire turns at -- the two contacts, the operator's bends, and the extra
   * corners the router adds to keep every run orthogonal. Its legs therefore
   * outnumber the bends, and its last leg has no bend index at all because it
   * ends at the far contact.
   *
   * So the chosen leg is translated back: the leg leaving bend `i` is the leg
   * that a waypoint inserted *at* `i` would split, which is what makes the
   * waypoint appear where the pointer was. The final leg clamps to the end,
   * because a waypoint after the last bend is the last position in the list.
   */
  bendIndexNear(wireId: string, x: number, y: number): number {
    const wire = this.bench.wires.find((candidate) => candidate.id === wireId);
    if (!wire) return 0;
    const from = this.bench.terminals[wire.from];
    const to = this.bench.terminals[wire.to];
    const legs = routeWireViaCorners(from, wire.bends, to);

    // Compare the pointer against each leg's midpoint; the leg the pointer
    // lands nearest is the leg a new waypoint would belong to.
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < legs.length - 1; i++) {
      const middleX = (legs[i].x + legs[i + 1].x) / 2;
      const middleY = (legs[i].y + legs[i + 1].y) / 2;
      const distance = Math.hypot(x - middleX, y - middleY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return Math.min(best, wire.bends.length);
  }

  /**
   * Places a part and returns it.
   *
   * The definition's id has to be a catalogue id -- a document names types,
   * not definitions -- which every catalogue factory satisfies. A definition
   * from somewhere else cannot be saved, so this refuses instead of placing
   * something the document cannot describe.
   */
  addPart(definition: PartDefinition, x: number, y: number): PartInstance {
    const result = addPartToDoc(this.doc, definition.id, x, y);
    if (result.error !== undefined || result.partId === undefined) {
      throw new Error(result.error ?? 'part placement did not allocate an id');
    }
    const before = this.doc;
    if (!this.applyDocument(result.doc)) {
      throw new Error('part placement produced an unloadable circuit');
    }
    this.pushUndo(before);
    // A scripted part is the one thing that needs the runtime; start loading it
    // the moment one exists, and let `scriptedReady` be what anyone waits on.
    void this.scriptedReady();
    const placed = this.bench.parts.find((candidate) => candidate.id === result.partId);
    if (!placed) throw new Error(`part ${result.partId} was not placed`);
    return placed;
  }

  /**
   * Puts a whole circuit on the bench, replacing whatever was there.
   *
   * This is how every stored, shared or shipped circuit arrives: the document
   * is compiled to a bench snapshot and an operator state, and the bench is put
   * back from them. A document that fails to compile changes nothing and hands
   * back its errors, so the caller can keep the bench it had and say why -- a
   * half-wired circuit would be worse than the one the operator was looking at.
   *
   * `compile` builds its own bench from an empty one, so a document carries the
   * board and the breadboard itself; nothing is placed before this call on
   * purpose, because the restore discards it.
   */
  loadCircuit(doc: CircuitDocument): string[] {
    const errors = this.adoptCircuit(doc);
    // A seed is a starting point, not a list of edits: nothing to step back to.
    if (errors.length === 0) this.clearHistory();
    void this.scriptedReady();
    return errors;
  }

  /**
   * Puts a document on the bench as one undoable step.
   *
   * The document is the circuit, so this is `loadCircuit` plus history: an
   * example replaces the bench, and the operator may well want theirs back with
   * one Ctrl+Z. A seed uses `loadCircuit` instead, which forgets history.
   */
  replaceCircuit(doc: CircuitDocument): string[] {
    const before = this.doc;
    const errors = this.adoptCircuit(doc);
    if (errors.length === 0) this.pushUndo(before);
    return errors;
  }

  /** Validates a document against this bench and adopts it; returns refusals. */
  private adoptCircuit(doc: CircuitDocument): string[] {
    const { bench, snapshot, dynamicState, errors } = compile(doc);
    if (errors.length > 0 || bench === null || snapshot === null || dynamicState === null)
      return errors;
    // The pin model belongs to the board this Simulation was built for, so a
    // document naming another board -- or no board at all -- would place its
    // parts against the wrong pin map and wire nothing. Document and bench have
    // to agree before anything is put down.
    const board = bench.parts.find((part) => part.definition.component.kind === 'mcu');
    if (!board) return ['circuit has no board'];
    if (board.definition.id !== this.mcu.definition.id) {
      return [`circuit is for ${board.definition.id}, this bench is ${this.mcu.definition.id}`];
    }
    // The document is the live state from here: the bench below is its first
    // projection, and every later edit is an operation over this value.
    this.doc = structuredClone(doc);
    this.builder.restore(snapshot);
    this.controls.copyValuesFrom(dynamicState);
    this.rebuild();
    return [];
  }

  /**
   * World position of a board pin by its *silkscreen* name.
   *
   * The name on the board, not the internal id: `D8`, `A0`, `5V`, `GND`. An
   * exercise has to be able to say "wire D8 to the LED" in the words the
   * worksheet and the silkscreen both use, and the internal ids
   * (`J1_D8`) are a drawing detail that would leak the board's own geometry
   * into every lesson.
   *
   * A leading `D` is optional on the digital pins, because the silkscreen says
   * `8` where a worksheet says `D8`. Anything that matches neither is null
   * rather than a guess: a lesson that wired the wrong pin because a name
   * nearly matched would be worse than one that says it cannot find it.
   */
  boardTerminal(name: string): Terminal | null {
    const pin = this.mcu.definition.pins.find((candidate) => candidate.label === name);
    if (pin) return { id: -1, x: pin.x, y: pin.y };
    if (!name.startsWith('D')) return null;
    const bare = name.slice(1);
    const digital = this.mcu.definition.pins.find((candidate) => candidate.label === bare);
    return digital ? { id: -1, x: digital.x, y: digital.y } : null;
  }

  /**
   * World position of one of a placed part's own pins.
   *
   * Returns the *contact* rather than a bare coordinate, so a wire drawn to it
   * shares the part's contact instead of claiming a loose terminal beside it --
   * which is the difference between a wire that is connected to the LED and
   * one that ends a pixel away from it.
   */
  pinAt(part: PartInstance, pinId: string): Terminal | null {
    const id = part.terminals[pinId];
    return id === undefined ? null : (this.bench.terminals[id] ?? null);
  }

  removePart(id: string): void {
    this.edit((doc) => removePartFromDoc(doc, id));
  }

  /** Holds a momentary contact down or lets it spring back. */
  setPressed(partId: string, pressed: boolean): void {
    this.controls.setPressed(partId, pressed);
    this.rebuild();
  }

  /** Moves one of a part's controls and re-solves around it. */
  setKnob(partId: string, spec: KnobSpec, value: number): void {
    this.recordKnob(partId, spec, value);
    this.engine.resampleScripted();
    this.rebuild();
  }

  /**
   * Records a knob position without re-solving.
   *
   * A knob is operator state rather than wiring: the document keeps it because
   * that is what the next load starts from, but turning one must not recompile
   * the bench -- and in the worker path the worker owns stepping, so the main
   * thread only has to keep the record straight.
   */
  recordKnob(partId: string, spec: KnobSpec, value: number): void {
    this.controls.setKnob(partId, spec, value);
    const result = setKnobInDoc(this.doc, `${partId}:${spec.id}`, value);
    if (result.error !== undefined) {
      console.warn(`circuit edit refused: ${result.error}`);
      return;
    }
    this.doc = result.doc;
  }

  /**
   * Turns a display part a quarter turn, from the Inspector.
   *
   * Separate from `setKnob` because this changes nothing electrical. Turning a
   * panel redraws the same pixels through a different pair of axes, so the
   * circuit is exactly as it was and re-solving the netlist would be work with
   * no result -- and doing it on every click made the bench stutter.
   *
   * A monochrome panel has no such axis to swap, so it is left alone.
   */
  rotateDisplay(partId: string): void {
    const controller = this.engine.displayController(partId);
    if (!(controller instanceof Ili9341)) return;
    // Landscape to portrait and back. The two intermediate orientations turn
    // the picture on its side rather than changing which axis is which, and for
    // "show me the other shape" a quarter turn is the one that helps.
    const next = controller.width > controller.height ? 0 : 1;
    controller.setRotation(next);
  }

  /** A colour panel's current screen size, as `width × height`. */
  displaySize(partId: string): string | undefined {
    const controller = this.engine.displayController(partId);
    if (!(controller instanceof Ili9341)) return undefined;
    return `${controller.width} × ${controller.height}`;
  }

  /** Volts on each board pin's net, keyed for the footprint renderer. */
  pinVoltages(): Map<string, number> {
    const netlist = this.engine.currentNetlist;
    const volts = new Map<string, number>();
    for (const part of this.bench.parts) {
      // Breadboards are excluded: their 882 holes are drawn as part of the
      // board itself and never queried for a voltage.
      if (part.definition.component.kind === 'breadboard') continue;
      for (const pin of part.definition.pins) {
        const net = netlist.pinNode.get(`${part.id}:${pin.id}`) ?? GROUND;
        volts.set(`${part.id}:${pin.id}`, this.engine.voltageOfNet(net));
      }
    }
    return volts;
  }

  /**
   * Turns a placed part a quarter turn, clockwise.
   *
   * The circuit follows: a pin that moves carries its contacts with it, so a
   * jumper clipped into a part stays clipped to that part rather than to the
   * hole the lead happened to be sitting in. Turning a part is a change to the
   * circuit and not only to the picture, so the netlist is re-solved after it --
   * a resistor on its side reaches different contacts, and leaving the old
   * ones solved would show the circuit the part had before it was turned.
   */
  rotatePart(partId: string): void {
    const part = this.bench.parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    /*
     * A turn is an edit like any other, so it goes in the history. Without
     * this the undo an operator reaches for after an accidental turn steps back
     * over whatever came before it instead -- and on a freshly loaded project
     * that "whatever" is the project's own last wire, so the recovery gesture
     * quietly breaks the circuit it was meant to protect.
     */
    this.edit((doc) => rotatePartInDoc(doc, partId, ((part.rotation + 90) % 360) as Rotation));
  }

  /** Which way up a part is, for the readout in the inspector. */
  partRotation(partId: string): Rotation {
    const part = this.bench.parts.find((candidate) => candidate.id === partId);
    return part?.rotation ?? 0;
  }

  /**
   * Names a part for the operator. Blank clears back to the definition
   * default. Display-only: identity and nets keep keying on the part id.
   */
  renamePart(partId: string, name: string): void {
    // Blank clears back to the definition default, and surrounding space is not
    // part of a name: the document stores what the inspector would show. A
    // rename is now an edit like any other, so it lands in the history too.
    const trimmed = name.trim();
    this.edit((doc) => setPartNameInDoc(doc, partId, trimmed === '' ? null : trimmed));
  }

  /** Operator-given name, or null when the part shows its definition name. */
  partName(partId: string): string | null {
    const part = this.bench.parts.find((candidate) => candidate.id === partId);
    return part?.name ?? null;
  }

  /**
   * Paints a button cap from the fixed palette. Display-only like renaming.
   */
  setCapColour(partId: string, colour: string): void {
    this.edit((doc) => setCapColourInDoc(doc, partId, colour));
  }

  /** Servo models, so the artwork can draw each horn where it was told to. */
  servoModels(): ReadonlyMap<string, Servo> {
    const servos = new Map<string, Servo>();
    for (const part of this.bench.parts) {
      const servo = this.engine.servo(part.id);
      if (servo) servos.set(part.id, servo);
    }
    return servos;
  }

  /** Stepper shaft angles, so the artwork can draw each rotor turned. */
  stepperAngles(): ReadonlyMap<string, number> {
    return this.engine.stepperAngles();
  }

  /** Addressable LED colors by part, so the artwork can paint each die. */
  pixelColors(): ReadonlyMap<string, ReadonlyArray<PixelColor>> {
    const colors = new Map<string, ReadonlyArray<PixelColor>>();
    for (const part of this.bench.parts) {
      const kind = part.definition.component.kind;
      if (kind !== 'neopixel' && kind !== 'neopixel-matrix' && kind !== 'led-ring') continue;
      colors.set(part.id, this.engine.pixelColors(part.id));
    }
    return colors;
  }

  /** Character LCD models, so the artwork can show what reached the glass. */
  lcdModels(): ReadonlyMap<string, Lcd1602> {
    const lcds = new Map<string, Lcd1602>();
    for (const part of this.bench.parts) {
      const lcd = this.engine.lcd(part.id);
      if (lcd) lcds.set(part.id, lcd);
    }
    return lcds;
  }

  /** Live controller models for every display part, for the UI to render. */
  displayControllers(): Map<string, DisplayController> {
    const controllers = new Map<string, DisplayController>();
    for (const part of this.bench.parts) {
      const controller = this.engine.displayController(part.id);
      if (controller) controllers.set(part.id, controller);
    }
    return controllers;
  }
  /**
   * Serial output, as a new array whenever it has actually changed.
   *
   * The buffer is mutated in place on every write, which is right for a chatty
   * sketch but means its identity never changes -- and a memoising renderer
   * would then never re-read it. Handing out a fresh array only on real changes
   * keeps the monitor live without re-rendering 60 times a second for nothing.
   */
  /**
   * Script faults latched by the in-page runtime, for the Problems panel.
   *
   * The worker path reports the same rows across its own message channel: the
   * faults are latched in whichever realm owns the script's context.
   */
  faults(): readonly ScriptFault[] {
    return reportedFaults();
  }

  serialLines(): readonly string[] {
    if (this.serialDirty) {
      this.serialSnapshot = [...this.serial];
      this.serialDirty = false;
    }
    return this.serialSnapshot;
  }

  /** Transfers over the I2C and SPI buses, oldest first. */
  busLines(): readonly BusEntry[] {
    return this.busLog.lines();
  }

  clearBusLog(): void {
    this.busLog.clear();
  }

  /**
   * Adds or removes a pin from the logic analyser's capture.
   *
   * Watching follows the *net* the pin sits on, exactly as the scope probe
   * does, so a pin wired to something interesting shows that thing's level.
   */
  toggleAnalysedPin(pinId: string): void {
    if (this.analysedPins.includes(pinId)) {
      this.engine.probes.unwatch(this.engine.netOfMcuPin(pinId));
      this.analysedPins = this.analysedPins.filter((id) => id !== pinId);
    } else {
      this.engine.probes.watch(this.engine.netOfMcuPin(pinId));
      this.analysedPins = [...this.analysedPins, pinId];
    }
  }

  /** Whether the logic analyser is capturing a pin. */
  isPinAnalysed(pinId: string): boolean {
    return this.analysedPins.includes(pinId);
  }

  /**
   * One captured trace per analysed pin, named by the header label the
   * operator sees on the silkscreen rather than by the pin's id.
   */
  analyserTraces(): ReadonlyArray<{ label: string; samples: TraceSample[] }> {
    return this.analysedPins.map((pinId) => {
      const waveform = this.engine.probes.waveform(this.engine.netOfMcuPin(pinId));
      return {
        label: this.mcu.pins().find((pin) => pin.id === pinId)?.label ?? pinId,
        samples: waveform?.toArray() ?? [],
      };
    });
  }

  /**
   * Advances one rendered frame.
   *
   * Simulated time tracks wall-clock time at the chosen time scale: each
   * frame gets a budget derived from how long the frame actually took, and a
   * firmware `delay` is spent across as many frames as it needs rather than
   * all at once. Without that, a 400 ms delay would complete inside a single
   * frame and the whole simulation would run several times faster than the
   * hardware it models.
   */
  tick(wallDeltaSeconds: number): void {
    if (!this.running) return;

    const budgetMs = Math.min(wallDeltaSeconds * 1000 * this.timeScale, MAX_FRAME_MS);
    const frameEnd = this.engine.timeMs + budgetMs;

    let slice = 0;
    while (this.engine.timeMs < frameEnd && slice++ < MAX_SLICES_PER_FRAME) {
      if (this.avrBackend) {
        this.avrBackend.step(Math.max(frameEnd - this.engine.timeMs, 0));
        this.engine.settle();
        if (this.avrBackend.fault) {
          this.firmwareError = this.avrBackend.fault;
          this.avrBackend = null;
          this.execution = 'interpreter';
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
      let requested: number | null;
      try {
        requested = this.runner.step();
      } catch (error) {
        /*
         * A sketch that raised an error it did not catch stops here, and the
         * reason is said out loud. Letting the error out of the frame would
         * take the whole page with it.
         */
        this.firmwareError = describeFirmwareError(error);
        this.runner = null;
        break;
      }
      if (requested === null) break;
      this.pendingDelayMs = requested;
      // One settle per step, not per pin write: a display refresh alone is a
      // dozen writes, and only this final state is ever observed.
      this.engine.settle();
    }

    // Whatever budget the firmware did not use still keeps the circuit
    // resolving, so a paused sketch shows a live, settled bench. One call:
    // advanceBy jumps for free when nothing can have moved and otherwise
    // paces itself, so this costs solves only where they can change answers.
    this.advanceBy(frameEnd - this.engine.timeMs);
  }

  /** Simulated milliseconds a firmware `delay` still owes before it resumes. */
  private pendingDelayMs = 0;

  private readonly spi = new SpiBus(
    // The byte the selected device shifted back out, or null when nobody on
    // the pins heard the byte: the sketch reads the answer, so it has to
    // travel back up the same path the write came down.
    (byte, dataSelect, chipSelected) => this.engine.deliverSpi(byte, dataSelect, chipSelected),
    () => this.engine.endSpiTransfer(),
  );

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
    // Coarse chunks stay wide (a whole frame at most): capacitors alone ride
    // Backward Euler stably at any step, and every firmware event settles on
    // its own — so one 40 ms step answers what four 10 ms steps did, at a
    // quarter of the solves.
    const chunkMs = this.engine.needsFineSteps ? 2 : 40;
    const endTime = this.engine.timeMs + ms;
    let guard = 0;
    while (this.engine.timeMs < endTime && guard++ < 4000) {
      const remaining = endTime - this.engine.timeMs;
      this.engine.step(Math.min(remaining, chunkMs) / 1000);
    }
  }

  private readonly i2c = new I2CBus(
    (address, byte, isControl) => this.engine.writeI2C(address, byte, isControl),
    (address, count) => this.engine.requestI2C(address, count),
  );

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

  rebuild(): void {
    this.engine.rebuild(this.builder.build(), this.controls);
    this.engine.settle();
    this.deriveLcdBoardPins();
    // The nets are numbered afresh, so the probes are re-resolved from their
    // pins: whatever the meter was clipped to, it is clipped to now.
    this.resolveMeterProbes();
    // The panel this driver is talking to may have just left the bench (a
    // replaced circuit); the next call binds to whatever is on it now.
    if (
      this.lcdDriverPartId !== null &&
      !this.bench.parts.some((part) => part.id === this.lcdDriverPartId)
    ) {
      this.lcdDriver = null;
      this.lcdDriverPartId = null;
    }
  }

  /**
   * The board pins the character LCD's lines reach, read back off the wiring.
   *
   * Derived on every rebuild rather than recorded when a part is placed,
   * because the wiring is the fact. A map written at placement time goes stale
   * the moment a jumper is moved, and it is empty altogether for a bench that
   * arrived as a document -- where nothing was placed by the example path, and
   * the panel would sit on correctly wired lines reading nothing.
   *
   * A line the panel is not wired to, or that reaches no pin firmware can name,
   * simply has no entry: that is how a display on the wrong header stays dark.
   */
  private deriveLcdBoardPins(): void {
    this.lcdBoardPins.clear();
    const gpioByNet = new Map<number, number>();
    for (const pin of this.mcu.pins()) {
      if (pin.gpio === undefined) continue;
      const net = this.engine.netOfMcuPin(pin.id);
      if (net === GROUND) continue;
      gpioByNet.set(net, pin.gpio);
    }
    const netlist = this.engine.currentNetlist;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'lcd') continue;
      for (const spec of part.definition.pins) {
        // The supply pins are joined inside the module rather than driven by a
        // board pin, so they are not lines the host writes to.
        if (spec.net !== undefined) continue;
        const net = netlist.pinNode.get(`${part.id}:${spec.id}`);
        const gpio = net === undefined ? undefined : gpioByNet.get(net);
        if (gpio !== undefined) this.lcdBoardPins.set(spec.id, gpio);
      }
    }
  }

  /**
   * The board pin each of the panel's lines reaches, derived on every rebuild
   * from the wiring (see `deriveLcdBoardPins`). A line the panel is not wired
   * to has no entry, and every write to it is skipped.
   */
  private readonly lcdBoardPins = new Map<string, number>();

  /**
   * The character LCD on the bench, and the board pins its header sits on.
   *
   * There is only ever one on a bench: a second would need a second host
   * object, and the sketch language here has no way to name one.
   *
   * The driver wraps a *panel*, so it is re-bound rather than kept when that
   * panel leaves the bench — replacing the circuit (an example, a link, a file)
   * takes the panel away and puts a new one on, and a driver still holding the
   * old one would drive the backlight of a part nobody can see.
   */
  private characterLcd(): LcdDriver | null {
    if (!this.lcdDriver) {
      for (const part of this.bench.parts) {
        const panel = this.engine.lcd(part.id);
        if (panel) {
          this.lcdDriver = new LcdDriver(panel);
          this.lcdDriverPartId = part.id;
        }
      }
    }
    return this.lcdDriver;
  }

  private lcdDriver: LcdDriver | null = null;
  private lcdDriverPartId: string | null = null;

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
    // time and shifts the halves together itself.
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
    for (const line of this.lcdPins().all) {
      if (line >= 0) this.mcu.setDirection(line, 'output');
    }
  }

  /** One HD44780 byte: four data lines with an enable strobe around them. */
  /**
   * One nibble onto the panel's four data lines, with an enable strobe.
   *
   * The nibble, not the byte: a four-bit HD44780 never sees a whole one, and
   * the panel joins the halves again on its own side.
   */
  private strokeLcd(isData: boolean, value: number): void {
    const pins = this.lcdPins();
    const level = (line: number, high: boolean) => {
      if (line >= 0) this.mcu.writeDigital(line, high, this.engine.timeMs);
    };
    level(pins.rs, isData);
    /*
     * The five data lines carry one byte whole, bit 4 on D4 down to bit 0 on
     * D0 -- which is a sixth bit short of a full byte, and the reason a real
     * HD44780 in four-bit mode sends a nibble at a time and never asks the
     * panel to carry more than four bits in one go.
     */
    level(pins.data[0], ((value >> 4) & 1) === 1);
    level(pins.data[1], ((value >> 3) & 1) === 1);
    level(pins.data[2], ((value >> 2) & 1) === 1);
    level(pins.data[3], ((value >> 1) & 1) === 1);
    level(pins.data[4], (value & 1) === 1);
    if (pins.enable < 0) return;
    /*
     * The panel latches on the rising edge of enable. The low level arms the
     * edge detector, which `primeLcdEdges` does directly: the low solve exists
     * only to set that flag, and the voltages it produces are superseded by
     * the high solve that follows. One solve per nibble keeps an LCD-heavy
     * loop (tens of characters per iteration) from blocking the frame.
     */
    level(pins.enable, false);
    this.engine.primeLcdEdges();
    level(pins.enable, true);
    this.engine.settle();
  }

  /**
   * The panel's own header, resolved to board pin numbers.
   *
   * A pin the panel is not wired to comes back as -1, and every write to it is
   * skipped, which is how a display on the wrong header ends up dark.
   */
  /**
   * The board pins driving the panel's control lines.
   *
   * Read back from the wiring rather than from the nets, because a net is not a
   * pin: two holes can share one, and looking a control line up by the net it
   * landed on finds whichever of them the board happens to list first.
   */
  private lcdPins(): {
    rs: number;
    enable: number;
    data: readonly number[];
    all: readonly number[];
  } {
    const on = (line: string): number => this.lcdBoardPins.get(line) ?? -1;
    // D4 first: the panel's bit 4 is on its D4, and the order here is the
    // order the host writes them in.
    const data = ['D4', 'D5', 'D6', 'D7', 'D0'].map(on);
    const rs = on('RS');
    const enable = on('E');
    return { rs, enable, data, all: [rs, enable, ...data].filter((pin) => pin >= 0) };
  }

  /**
   * Lights or dims the backlight, which on this module is a pin rather than a
   * command -- so it is driven through the same header as everything else.
   */
  private backlight(on: boolean): void {
    const panel = this.characterLcd()?.target;
    panel?.setBacklight(on);
    this.engine.settle();
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

  /** Sonar part armed by the running `pulseIn`, released when it returns. */
  private sonarArmed: string | null = null;

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

  /**
   * The map port a sketch talks to.
   *
   * The firmware has no radio, so this is the host standing in for one: it
   * keeps what has arrived, starts fetching what a sketch asks for, and hands
   * finished tiles to the panel. A program cannot tell which of those it is
   * getting, which is the point -- the shape of the API is the shape of a real
   * HTTP client, down to `request` answering "not yet".
   */
  private readonly tiles = new TileStore();

  private readonly fetcher = new TileFetcher();

  /**
   * The bench's network, on this simulation's clock.
   *
   * Built from the shared adapter (`simulation/net/`), so the in-page bench and
   * the worker run the same network rather than two that have to be kept in
   * step by hand.
   */
  private readonly net: VirtualNetwork;

  private readonly map: MapPort = {
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
  };

  private services(): FirmwareServices {
    return {
      // The board's own pin namespace: on most boards a sketch's pin number is
      // the GPIO number, and on the Nano RP2040 Connect it is not.
      pins: this.mcu.arduinoPins,
      // The Python vocabulary this board's runtime speaks: `machine` on the
      // MicroPython boards, `gpiozero` on a Raspberry Pi.
      pythonModules: pythonModulesFor(this.mcu.board.id),
      // Built here rather than as a field: `this.engine` is assigned in the
      // constructor body, and a field initializer would run before it.
      tft: createTftPort(this.engine, () => this.displayControllers()),
      map: this.map,
      net: createNetPort(this.net),
      nowMs: () => this.engine.timeMs,
      pinMode: (pin, mode) => {
        // No settle here: pin writes only retarget future solves, and the
        // slice loop settles once per step below. Settling per write meant a
        // 13-write display refresh paid 13 full solves, most of them on
        // intermediate states nothing ever observes.
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
      /*
       * The LCD drives its own header, exactly as the library does: every
       * command becomes RS, four data lines and a strobe on E. The engine
       * reads those pins back into the panel, so an LCD on the wrong header
       * stays blank rather than working anyway.
       */
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
