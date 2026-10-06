/**
 * Deliberately a plain class rather than a hook. The bench holds a fully
 * populated breadboard of nearly a thousand terminals, and rebuilding that
 * through React state on every drag frame would be absurd; keeping the mutable
 * model here and letting React re-render from a version counter keeps the
 * expensive work out of the render path entirely.
 */

import {
  BenchBuilder,
  type Bench,
  type BenchSnapshot,
  type BendPoint,
  type PartInstance,
  type Terminal,
  type WireEnd,
} from '../sim/bench';
import { Engine } from '../sim/engine';
import { McuRuntime } from '../sim/mcu';
import {
  FirmwareRunner,
  type FirmwareLanguage,
  type FirmwareServices,
} from '../sim/firmware/interpreter';
import { FirmwareSyntaxError } from '../sim/firmware/parser';
import type { BoardPin, KnobSpec, PartDefinition } from '../sim/catalog';
import { EXAMPLE_DEVICES, LCD_LINES, type ExampleDevice } from './examples';
import { nextAutomaticWireColour } from './wire-colours';

import { GROUND } from '../sim/elements';
import { DISTANCE_KNOB, echoMicroseconds } from '../sim/sonar';
import { HUMIDITY_KNOB } from '../sim/dht';
import { pixelCount, type PixelColor } from '../sim/pixels';
import { TEMPERATURE_KNOB } from '../sim/modules';
import type { DisplayController } from '../sim/display/part';
import { Ili9341, type PanelRotation } from '../sim/display/ili9341';
import { TileFetcher } from './map-fetcher';
import { TILE_SIZE, TileStore } from './map-tiles';
import type { MapPort, TftPort } from '../sim/firmware/interpreter';
import { I2CBus } from '../sim/bus/i2c';
import { SpiBus } from '../sim/bus/spi';
import { BusLog, type BusEntry } from '../sim/bus/log';
import type { Servo } from '../sim/devices/servo';
import type { Lcd1602 } from '../sim/devices/lcd';
import { LcdDriver, type LcdCommand } from '../sim/devices/lcd-driver';


import type { TraceSample } from '../sim/probe';
import {
  AMP_RANGES,
  OHM_RANGES,
  Multimeter,
  type AmpRange,
  type MeterMode,
  type MeterReading,
  type OhmRange,
} from '../sim/multimeter';

import { DynamicState } from '../sim/catalog';
import { routeWireViaCorners } from './wire-route';
/** Longest slice of simulated time one rendered frame may cover. */
const MAX_FRAME_MS = 40;
/** Upper bound on generator steps per frame, so a runaway loop cannot hang. */
const MAX_SLICES_PER_FRAME = 400;

/**
 * Simulated time per second of wall-clock time. 1 keeps the bench running at
 * the speed a person would actually observe; raise it to watch a slow sketch
 * without waiting for it.
 */
const TIME_SCALE = 1;

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
 * How many bench states are kept. Beyond this the oldest falls off the end.
 *
 * Sixty is a lot of steps for a wiring bench and still only a few thousand
 * small records; the cap is there so an afternoon of nudging parts cannot grow
 * the history without bound.
 */
const HISTORY_LIMIT = 60;

/**
 * How long a run of the same continuous edit collapses into one undo step.
 *
 * Drags call into the model on every animation frame, so a single nudge of a
 * part across the bench is sixty calls. Without coalescing, one Ctrl+Z would
 * step back through the drag a frame at a time and look like undo was broken.
 * The window slides, so a drag lasting longer than this still collapses to one
 * step rather than starting a second one halfway through.
 */
const EDIT_COALESCE_MS = 700;

/**
 * One undoable step: the bench, plus the bookkeeping that describes it.
 *
 * The extras are not decoration. `examplePartIds` decides which parts the next
 * example load clears, and `lcdBoardPins` is how an LCD finds the board pins
 * its lines were wired to; restoring the bench without them would leave the
 * model describing a bench that is no longer there.
 */
interface BenchHistoryEntry {
  readonly bench: BenchSnapshot;
  readonly examplePartIds: string[];
  readonly lcdPins: [string, number][];
}

export class Simulation {
  readonly builder = new BenchBuilder();
  readonly mcu: McuRuntime;
  readonly engine: Engine;

  runner: FirmwareRunner | null = null;
  firmwareError: string | null = null;
  serial: string[] = [];
  running = false;

  /** What the operator is doing to the parts, shared with the renderers. */
  readonly controls = new DynamicState();
  private firmwareSource = '';
  /** Which grammar the loaded source is written in. */
  firmwareLanguage: FirmwareLanguage = 'arduino-cpp';
  private serialSnapshot: string[] = [];

  /**
   * Board pins the logic analyser is watching.
   *
   * Held as ids rather than nets because a net is only known once the bench
   * settles, and the operator picks pins before anything moves.
   */
  private analysedPins: string[] = [];
  private readonly busLog = new BusLog();

  /**
   * Part ids the current example placed, so the next load can take them away.
   *
   * An example owns the parts it adds and nothing else. Without this, loading
   * an example twice stacks a second LCD on top of the first at the same
   * coordinates and doubles every wire -- which reads as the bench falling
   * apart rather than as parts accumulating. The board, the breadboard and
   * anything the operator placed by hand are untouched.
   */
  private examplePartIds: string[] = [];
  private serialDirty = true;

  constructor(board: PartDefinition) {
    this.mcu = new McuRuntime(board);
    this.engine = new Engine({ bench: this.builder.build(), mcu: this.mcu, dynamicState: this.controls });
  }
  get bench(): Bench {
    return this.builder.build();
  }

  /*
   * Undo history, as whole bench states.
   *
   * Snapshots rather than inverse operations. Every mutation would otherwise
   * need a matching undo, including the ones that renumber contacts when a
   * wire leaves a hole, and the tenth one added later would silently be the one
   * nobody can undo. A state cannot drift out of step with the model because it
   * *is* the model, frozen.
   *
   * The rest of the bench's bookkeeping travels with it. `examplePartIds` says
   * which parts an example owns, and `lcdBoardPins` maps an LCD's lines to
   * board pins; both are written and cleared by the same operations that place
   * parts and wires, so restoring the bench without them would leave the bench
   * claiming ownership of parts that are gone and an LCD wired to pins that no
   * longer lead anywhere.
   */
  private undoStack: BenchHistoryEntry[] = [];
  private redoStack: BenchHistoryEntry[] = [];
  /** The continuous edit currently being coalesced, and when it started. */
  private editRun: { kind: string; at: number } | null = null;

  /** Records the bench as it is, before the caller changes it. */
  private checkpoint(kind?: string): void {
    const now = performance.now();
    if (
      kind !== undefined &&
      this.editRun !== null &&
      this.editRun.kind === kind &&
      now - this.editRun.at < EDIT_COALESCE_MS
    ) {
      // Still the same drag: the first frame already recorded the state this
      // run started from, and that is the state undo should return to.
      this.editRun.at = now;
      return;
    }

    this.undoStack.push(this.historyEntry());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    // Anything that was undone can no longer be redone: the future it pointed
    // at has just been edited away.
    this.redoStack.length = 0;
    this.editRun = kind === undefined ? null : { kind, at: now };
  }

  /** The whole of the bench's restorable state, frozen. */
  private historyEntry(): BenchHistoryEntry {
    return {
      bench: this.builder.snapshot(),
      examplePartIds: [...this.examplePartIds],
      lcdPins: [...this.lcdBoardPins],
    };
  }

  /** Puts a history entry back into the live model. */
  private applyHistory(entry: BenchHistoryEntry): void {
    this.builder.restore(entry.bench);
    this.examplePartIds = entry.examplePartIds;
    this.lcdBoardPins.clear();
    for (const [line, pin] of entry.lcdPins) this.lcdBoardPins.set(line, pin);
    // The next edit starts a fresh run: coalescing into whatever was undone
    // would swallow the edit into a history entry that no longer describes it.
    this.editRun = null;
    this.rebuild();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Steps the bench back one edit. Returns whether there was one to step to. */
  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.historyEntry());
    this.applyHistory(previous);
    return true;
  }

  /** Steps the bench forward again. Returns whether there was one to step to. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.historyEntry());
    this.applyHistory(next);
    return true;
  }


  /** Loads firmware, reporting a syntax error instead of throwing at the UI. */
  loadFirmware(source: string, language: FirmwareLanguage = this.firmwareLanguage): void {
    this.firmwareSource = source;
    this.firmwareLanguage = language;
    this.serial = [];
    this.serialDirty = true;
    this.engine.timeMs = 0;
    this.mcu.reset();
    // A fresh sketch owes nothing: without this, the previous sketch's
    // in-flight delay would gate the new one, which reads as a hang.
    this.pendingDelayMs = 0;

    try {
      this.runner = new FirmwareRunner(source, this.services(), language);
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
    this.rebuild();
  }

  start(): void {
    if (!this.runner) this.loadFirmware(this.firmwareSource);
    this.running = true;
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

  /** Clips the multimeter onto two nets, or lifts it with nulls. */
  setMeterProbes(redNet: number | null, blackNet: number | null): void {
    this.meter.setProbes(redNet ?? GROUND, blackNet ?? GROUND);
    this.engine.setMeter(this.meter);
    this.engine.settle();
  }

  get meterMode(): MeterMode {
    return this.meter.mode;
  }

  setMeterMode(mode: MeterMode): void {
    this.meter.mode = mode;
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
    this.engine.timeMs = 0;
    this.mcu.reset();
    this.serial = [];
    this.runner = null;
    this.loadFirmware(this.firmwareSource);
  }

  movePart(partId: string, x: number, y: number): void {
    // One undo step per drag, not per frame: see `EDIT_COALESCE_MS`.
    this.checkpoint('movePart');
    this.builder.movePart(partId, x, y);
    this.rebuild();
  }

  /**
   * Routes a jumper, in the colour the operator has chosen.
   *
   * The chosen colour is passed in rather than read from here, so the picker in
   * the header and the wire it places cannot disagree about what colour "next"
   * means.
   */
  routeWire(
    from: Terminal,
    to: Terminal,
    bends: readonly BendPoint[] = [],
    colour?: string,
  ): void {
    this.checkpoint();
    this.builder.addWire(from.x, from.y, to.x, to.y, {
      colour: colour ?? nextAutomaticWireColour(this.bench.wires.length),
      bends,
    });
    this.rebuild();
  }

  /**
   * Re-clips one end of a placed jumper, the way Wokwi lets a wire be dragged.
   *
   * Re-solved because this is an electrical change: the wire now joins whatever
   * its two ends are, so every net it touched before may be different.
   */
  moveWireEnd(wireId: string, end: WireEnd, to: Terminal): void {
    // One undo step per drag, not per frame: see `EDIT_COALESCE_MS`.
    this.checkpoint('moveWireEnd');
    this.builder.moveWireEnd(wireId, end, to.x, to.y);
    this.rebuild();
  }

  /**
   * Takes a jumper off the bench.
   *
   * Re-solved because removing a wire opens whatever net it was the only link
   * in -- which is the point: pulling a jumper is how an operator disconnects
   * two things.
   */
  removeWire(wireId: string): void {
    this.checkpoint();
    this.builder.removeWire(wireId);
    this.rebuild();
  }

  /**
   * Recolours a placed jumper.
   *
   * Deliberately no re-solve: insulation carries no electrical meaning, so
   * nothing downstream can see this change and solving again would cost a full
   * circuit pass to produce the same answer.
   */
  setWireColour(wireId: string, colour: string): void {
    this.checkpoint();
    this.builder.setWireColour(wireId, colour);
  }

  /** Reshapes a placed jumper, re-measuring and re-solving it. */
  setWireBends(wireId: string, bends: readonly BendPoint[]): void {
    // One undo step per drag, not per frame: see `EDIT_COALESCE_MS`.
    this.checkpoint('setWireBends');
    this.builder.setWireBends(wireId, bends);
    this.rebuild();
  }

  removeWireBend(wireId: string, index: number): void {
    this.checkpoint();
    this.builder.removeWireBend(wireId, index);
    this.rebuild();
  }

  insertWireBend(wireId: string, index: number, bend: BendPoint): void {
    this.checkpoint();
    this.builder.insertWireBend(wireId, index, bend);
    this.rebuild();
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

  addPart(definition: PartDefinition, x: number, y: number): PartInstance {
    this.checkpoint();
    const part = this.builder.addPart(definition, x, y);
    this.rebuild();
    return part;
  }

  /**
   * Places one of an example's parts and wires it the way its sketch expects.
   *
   * The wiring is per part rather than per board because it is the part that
   * decides: an I2C module needs four wires to whatever the board calls its bus
   * pins, and a servo needs one signal plus its ground. Which pins those are is
   * the board's business, so they are asked for by pin number here.
   *
   * An example whose parts are not wired would be worse than no example: the
   * sketch would run and quietly read nothing, which is indistinguishable from
   * the API being broken.
   */
  placeExampleDevice(what: ExampleDevice, x: number, y: number): PartInstance {
    // One checkpoint for the whole device: the part and every wire it brings
    // are a single action, and undoing half of an example would leave a module
    // on the bench wired to nothing.
    this.checkpoint();
    const definition = EXAMPLE_DEVICES[what]();
    const part = this.builder.addPart(definition, x, y);
    // Recorded before the wiring so `clearExampleParts` can take the whole
    // example away, however many parts it ends up owning.
    this.examplePartIds.push(part.id);
    const bench = this.builder.build();
    const terminal = (pin: string): Terminal | undefined => {
      const id = part.terminals[pin];
      return id === undefined ? undefined : bench.terminals[id];
    };

    const wire = (pin: string, boardPin: string) => {
      if (!boardPin) return;
      const from = terminal(pin);
      if (!from) return;
      const to = this.boardPin(boardPin);
      if (!to) return;
      this.builder.addWire(from.x, from.y, to.x, to.y);
    };

    /*
     * Pins are asked for by the number firmware would name them with, not by the
     * silkscreen. The ESP32 calls its bus pins GPIO21 and GPIO22 where an Uno
     * calls the same wires SDA and SCL, and an example that worked on one board
     * and silently stopped on the other would be a bug the reader spends an
     * afternoon on.
     */
    const byNumber = (gpio: number): string => this.firstGpio((pin) => pin.gpio === gpio);
    const ground = this.firstGpio((pin) => pin.role === 'ground');

    if (what === 'servo') {
      // The signal, and the ground it references. The supply is left alone: a
      // servo wants its own 4.8 V, and joining it here would be deciding that
      // on the operator's behalf.
      // Pin 19 is a general-purpose pin on every board here, chosen because it
      // is on neither bus -- a signal line that shared a net with a display's
      // chip-select would drive both.
      wire('PWM', byNumber(19));
      wire('GND', ground);
    } else {
      const [sda, scl] = this.mcu.i2cPins;
      wire('SDA', byNumber(sda));
      wire('SCL', byNumber(scl));
      wire('GND', ground);
      wire('VCC', this.firstGpio((pin) => pin.role === 'power'));

      /*
       * A character LCD also needs its six control lines, or the glass stays
       * dark however correctly the clock behind it is wired. They go to whatever
       * general-purpose pins the board has going spare, in order, so the wiring
       * is the same on every board even though the pins differ.
       */
      if (what === 'lcd1602') {
        /*
         * The panel's lines to spare board pins, chosen by number and
         * remembered: its job is to find the same pin again, and a net is not a
         * pin -- two holes can share one, so resolving a line by the net it
         * landed on finds whichever of them the board happens to list first.
         */
        const taken = new Set([...this.mcu.i2cPins, ...this.mcu.spiPins]);
        // A pin firmware cannot name is no use here: the library addresses its
        // own lines by number, so a hole with none is not one it can hold.
        const spare = this.mcu.pins().filter(
          (pin) => pin.role === 'gpio' && pin.gpio !== undefined && !taken.has(pin.gpio),
        );
        LCD_LINES.forEach((line, index) => {
          const boardPin = spare[index];
          if (!boardPin) return;
          this.lcdBoardPins.set(line, boardPin.gpio ?? -1);
          wire(line, boardPin.id);
        });
        wire('VSS', ground);
      }
    }

    this.rebuild();
    return part;
  }

  /**
   * Lifts every part the previous example placed.
   *
   * Called before an example wires itself, so the bench holds one example at a
   * time. `removePart` takes each part's wires with it, which is what stops the
   * net count from climbing every time the same example is loaded again -- the
   * visible symptom of which is a bench that slowly fills with duplicate
   * modules and twice as many jumpers.
   */
  clearExampleParts(): void {
    if (this.examplePartIds.length === 0) return;
    // Recorded before anything is lifted, so one undo brings the whole example
    // back rather than only the parts after the first.
    this.checkpoint();
    for (const id of this.examplePartIds) this.builder.removePart(id);
    this.examplePartIds = [];
    // The LCD's line-to-pin map describes wiring that is no longer on the bench.
    this.lcdBoardPins.clear();
    this.rebuild();
  }

  /** World position of a board pin by id, for wiring a part to the board. */
  private boardPin(pinId: string): Terminal | null {
    const pin = this.mcu.definition.pins.find((candidate) => candidate.id === pinId);
    return pin ? { id: -1, x: pin.x, y: pin.y } : null;
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
    return id === undefined ? null : this.bench.terminals[id] ?? null;
  }

  /** The first board pin matching a predicate, which is how a board is asked. */
  private firstGpio(match: (pin: BoardPin) => boolean): string {
    return this.mcu.pins().find(match)?.id ?? '';
  }

  removePart(id: string): void {
    this.checkpoint();
    this.builder.removePart(id);
    this.rebuild();
  }

  /** Holds a momentary contact down or lets it spring back. */
  setPressed(partId: string, pressed: boolean): void {
    this.controls.setPressed(partId, pressed);
    this.rebuild();
  }

  /** Moves one of a part's controls and re-solves around it. */
  setKnob(partId: string, spec: KnobSpec, value: number): void {
    this.controls.setKnob(partId, spec, value);
    this.rebuild();
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
   * Simulated time tracks wall-clock time: each frame gets a budget derived
   * from how long the frame actually took, and a firmware `delay` is spent
   * across as many frames as it needs rather than all at once. Without that,
   * a 400 ms delay would complete inside a single frame and the whole
   * simulation would run several times faster than the hardware it models.
   */
  tick(wallDeltaSeconds: number): void {
    if (!this.running) return;

    const budgetMs = Math.min(wallDeltaSeconds * 1000 * TIME_SCALE, MAX_FRAME_MS);
    const frameEnd = this.engine.timeMs + budgetMs;

    let slice = 0;
    while (this.engine.timeMs < frameEnd && slice++ < MAX_SLICES_PER_FRAME) {
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
    }

    // Whatever budget the firmware did not use still keeps the circuit
    // resolving, so a paused sketch shows a live, settled bench.
    let guard = 0;
    while (this.engine.timeMs < frameEnd && guard++ < MAX_SLICES_PER_FRAME) {
      const remainingMs = frameEnd - this.engine.timeMs;
      this.engine.step(Math.min(remainingMs, 2) / 1000);
    }
  }

  /** Simulated milliseconds a firmware `delay` still owes before it resumes. */
  private pendingDelayMs = 0;

  private readonly spi = new SpiBus((byte, dataSelect, chipSelected) => {
    this.engine.deliverSpi(byte, dataSelect, chipSelected);
    return true;
  });

  /** Spends `ms` of simulated time on the circuit, without any firmware. */
  private advanceBy(ms: number): void {
    if (ms <= 0) return;

    // With no PWM and no capacitors the circuit cannot have changed, so a
    // one-second delay costs one solve rather than a thousand.
    if (!this.engine.hasDynamics()) {
      this.engine.skip(ms / 1000);
      return;
    }

    const endTime = this.engine.timeMs + ms;
    let guard = 0;
    while (this.engine.timeMs < endTime && guard++ < 4000) {
      const remaining = endTime - this.engine.timeMs;
      this.engine.step(Math.min(remaining, 2) / 1000);
    }
  }

  private readonly i2c = new I2CBus(
    (address, byte, isControl) => this.engine.writeI2C(address, byte, isControl),
    (address, count) => this.engine.requestI2C(address, count),
  );

  private rebuild(): void {
    this.engine.rebuild(this.builder.build(), this.controls);
    this.engine.settle();
  }


  /**
   * The character LCD on the bench, and the board pins its header sits on.
   *
   * There is only ever one on a bench: a second would need a second host
   * object, and the sketch language here has no way to name one.
   */
  /** The board pin each of the panel's control lines was wired to. */
  private readonly lcdBoardPins = new Map<string, number>();

  private characterLcd(): LcdDriver | null {
    if (!this.lcdDriver) {
      for (const part of this.bench.parts) {
        const panel = this.engine.lcd(part.id);
        if (panel) this.lcdDriver = new LcdDriver(panel);
      }
    }
    return this.lcdDriver;
  }

  private lcdDriver: LcdDriver | null = null;

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
     * The panel latches on the rising edge of enable, and it can only do that
     * after the data lines have settled -- so the circuit is solved with the
     * lines written and enable still low, and then again with enable high. One
     * solve for all of it is a single edge the solver never observes, and a
     * display wired correctly stays blank.
     */
    level(pins.enable, false);
    this.engine.settle();
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
  private lcdPins(): { rs: number; enable: number; data: readonly number[]; all: readonly number[] } {
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
      const panel = this.tft();
      if (!pixels || !panel) return false;
      panel.blit(destX, destY, pixels.length === 1 ? 1 : TILE_SIZE, TILE_SIZE, pixels);
      return true;
    },
    ready: () => this.tiles.complete && !this.fetcher.busy,
    reset: () => this.tiles.clearWanted(),
  };

  /** The colour TFT on the bench, which is where a map goes. */
  private tft(): Ili9341 | undefined {
    for (const controller of this.displayControllers().values()) {
      if (controller instanceof Ili9341) return controller;
    }
    return undefined;
  }

  /**
   * The colour panel as a sketch talks to it.
   *
   * The calls here are the library's convenience layer, not a second way to
   * draw: pixels still go out over SPI exactly as the register writes do. What
   * this adds is the one question SPI cannot answer -- how big the panel is
   * right now -- which changes when it is turned, so a sketch that assumed
   * 320x240 would be quietly wrong on a rotated one.
   */
  private readonly tftPort: TftPort = {
    setRotation: (rotation) => {
      const panel = this.tft();
      if (!panel) return 0;
      // The hardware clamps rather than refusing: an orientation outside 0..3
      // is folded to a real one, and saying which is the useful part.
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
  };

  private services(): FirmwareServices {
    return {
      tft: this.tftPort,
      map: this.map,
      nowMs: () => this.engine.timeMs,
      pinMode: (pin, mode) => {
        this.mcu.setDirection(pin, mode === 0 ? 'input' : mode === 2 ? 'inputPullUp' : 'output');
        this.engine.settle();
      },
      digitalWrite: (pin, level) => {
        this.mcu.writeDigital(pin, level !== 0, this.engine.timeMs);
        this.engine.settle();
      },
      digitalRead: (pin) => {
        this.engine.settle();
        return this.engine.readDigital(pin) ? 1 : 0;
      },
      analogWrite: (pin, value) => {
        this.mcu.writeAnalog(pin, value, this.engine.timeMs);
        this.engine.settle();
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
        this.serial.push(text);
        // Cap the buffer so a chatty sketch cannot grow it without limit.
        if (this.serial.length > 400) this.serial.splice(0, this.serial.length - 400);
        this.serialDirty = true;
      },
    };
  }
}
