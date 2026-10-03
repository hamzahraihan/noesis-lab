/**
 * Owns a bench, its circuit, and the firmware running on it.
 *
 * Deliberately a plain class rather than a hook. The bench holds a fully
 * populated breadboard of nearly a thousand terminals, and rebuilding that
 * through React state on every drag frame would be absurd; keeping the mutable
 * model here and letting React re-render from a version counter keeps the
 * expensive work out of the render path entirely.
 */

import {
  BenchBuilder,
  type Bench,
  type BendPoint,
  type PartInstance,
  type Terminal,
} from '../sim/bench';
import { Engine } from '../sim/engine';
import { McuRuntime } from '../sim/mcu';
import {
  FirmwareRunner,
  type FirmwareServices,
} from '../sim/firmware/interpreter';
import { FirmwareSyntaxError } from '../sim/firmware/parser';
import type { PartDefinition } from '../sim/catalog';
import { GROUND } from '../sim/elements';
import type { DisplayController } from '../sim/display/part';
import { I2CBus } from '../sim/bus/i2c';
import { SpiBus } from '../sim/bus/spi';
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

import type { DynamicState } from '../sim/catalog';
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
export const BLINK_SKETCH = `#include <Arduino.h>
#include <Wire.h>

#define LED_PIN 2
#define OLED_ADDR 0x3C

int blinks = 0;

void oledCommand(int c) {
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}

// A TFT command and its parameters share one chip-select window: the bytes
// after the command count as its parameters only while it is still selected.
void tftCommand(int command, int first, int second) {
  SPI.beginTransaction();
  SPI.transfer(command, 0);
  if (first >= 0) {
    SPI.transfer(first >> 8, 1);
    SPI.transfer(first & 255, 1);
  }
  if (second >= 0) {
    SPI.transfer(second >> 8, 1);
    SPI.transfer(second & 255, 1);
  }
  SPI.end();
}

// One RGB565 pixel, sent while a transfer is already open.
void tftPixel(int colour) {
  SPI.transfer(colour >> 8, 1);
  SPI.transfer(colour & 255, 1);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32 online");

  Wire.begin(21, 22);
  oledCommand(0xAE);
  // Page addressing, so each frame writes where it is told rather than
  // carrying on from wherever the last one stopped.
  oledCommand(0x20); oledCommand(0x02);
  oledCommand(0x21); oledCommand(0x00); oledCommand(0x7F);
  oledCommand(0x22); oledCommand(0x00); oledCommand(0x07);
  oledCommand(0x81); oledCommand(0x9F);
  oledCommand(0xA1); oledCommand(0xA6);
  oledCommand(0xA8); oledCommand(0x3F);
  oledCommand(0xD3); oledCommand(0x00);
  oledCommand(0xD5); oledCommand(0x80);
  oledCommand(0xD9); oledCommand(0x22);
  oledCommand(0xDA); oledCommand(0x12);
  oledCommand(0xDB); oledCommand(0x20);
  oledCommand(0x8D); oledCommand(0x14);
  oledCommand(0xAF);

  // Bring up the TFT. Leaving D/C on the wrong pin turns every one of these
  // commands into pixel data, and the panel fills with noise instead of drawing.
  SPI.begin();
  tftCommand(0x01, -1, -1);
  delay(50);
  tftCommand(0x11, -1, -1);
  delay(120);
  tftCommand(0x3A, 0x0055, -1);
  tftCommand(0x29, -1, -1);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(400);
  digitalWrite(LED_PIN, LOW);
  delay(400);

  // A bar along the top of the OLED.
  oledCommand(0xB0); oledCommand(0x00); oledCommand(0x10);
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x40);
  for (int i = 0; i < 40; i++) { Wire.write(0xFF); }
  Wire.endTransmission();

  // A bar along the top of the TFT: a 320-pixel window, forty of them lit.
  tftCommand(0x2A, 0x0000, 0x013F);
  tftCommand(0x2B, 0x0000, 0x00EF);
  SPI.beginTransaction();
  SPI.transfer(0x2C, 0);
  for (int i = 0; i < 40; i++) { tftPixel(0x001F); }
  for (int i = 0; i < 280; i++) { tftPixel(0x0000); }
  SPI.end();

  blinks++;
  Serial.print("blink ");
  Serial.println(blinks);
}
`;

/**
 * Real jumper colours, cycled so a populated board looks like a real one.
 *
 * Insulation colour carries no electrical meaning here, so it must not imply
 * any: the inspector reports the measured net, never a guess from the wire.
 */
const WIRE_COLOURS = [
  '#d94f4f', '#1f2937', '#eab308', '#22c55e',
  '#3b82f6', '#e5e7eb', '#f97316',
] as const;

function pickWireColour(wireIndex: number): string {
  return WIRE_COLOURS[wireIndex % WIRE_COLOURS.length];
}

export class Simulation {
  readonly builder = new BenchBuilder();
  readonly mcu: McuRuntime;
  readonly engine: Engine;

  runner: FirmwareRunner | null = null;
  firmwareError: string | null = null;
  serial: string[] = [];
  running = false;

  private pressedButtons = new Set<string>();
  private potPositions = new Map<string, number>();
  private firmwareSource = BLINK_SKETCH;
  private serialSnapshot: string[] = [];
  private serialDirty = true;

  constructor(board: PartDefinition) {
    this.mcu = new McuRuntime(board);
    this.engine = new Engine({ bench: this.builder.build(), mcu: this.mcu });
    this.engine.rebuild();
  }
  get bench(): Bench {
    return this.builder.build();
  }

  private get dynamicState(): DynamicState {
    return {
      pressedButtons: this.pressedButtons,
      potPositions: this.potPositions,
    };
  }

  /** Loads firmware, reporting a syntax error instead of throwing at the UI. */
  loadFirmware(source: string): void {
    this.firmwareSource = source;
    this.serial = [];
    this.serialDirty = true;
    this.engine.timeMs = 0;
    this.mcu.reset();

    try {
      this.runner = new FirmwareRunner(source, this.services());
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

  /** Rebuilds the circuit and restarts firmware from t=0. */
  reset(): void {
    this.engine.timeMs = 0;
    this.mcu.reset();
    this.serial = [];
    this.runner = null;
    this.loadFirmware(this.firmwareSource);
  }

  movePart(partId: string, x: number, y: number): void {
    this.builder.movePart(partId, x, y);
    this.rebuild();
  }

  routeWire(from: Terminal, to: Terminal, bends: readonly BendPoint[] = []): void {
    this.builder.addWire(from.x, from.y, to.x, to.y, {
      colour: pickWireColour(this.bench.wires.length),
      bends,
    });
    this.rebuild();
  }

  /** Reshapes a placed jumper, re-measuring and re-solving it. */
  setWireBends(wireId: string, bends: readonly BendPoint[]): void {
    this.builder.setWireBends(wireId, bends);
    this.rebuild();
  }

  removeWireBend(wireId: string, index: number): void {
    this.builder.removeWireBend(wireId, index);
    this.rebuild();
  }

  insertWireBend(wireId: string, index: number, bend: BendPoint): void {
    this.builder.insertWireBend(wireId, index, bend);
    this.rebuild();
  }

  /** Which leg of a wire a world position sits nearest, as a bend index. */
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
    return best;
  }

  addPart(definition: PartDefinition, x: number, y: number): PartInstance {
    const part = this.builder.addPart(definition, x, y);
    this.rebuild();
    return part;
  }

  removePart(id: string): void {
    this.builder.removePart(id);
    this.rebuild();
  }

  setButtonPressed(partId: string, pressed: boolean): void {
    if (pressed) this.pressedButtons.add(partId);
    else this.pressedButtons.delete(partId);
    this.rebuild();
  }

  setPotPosition(partId: string, fraction: number): void {
    this.potPositions.set(partId, Math.min(1, Math.max(0, fraction)));
    this.rebuild();
  }

  isButtonPressed(partId: string): boolean {
    return this.pressedButtons.has(partId);
  }

  potPosition(partId: string): number {
    return this.potPositions.get(partId) ?? 0.5;
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

  private readonly i2c = new I2CBus((address, byte, isControl) =>
    this.engine.deliverI2C(address, byte, isControl),
  );

  private rebuild(): void {
    this.engine.rebuild(this.builder.build(), this.dynamicState);
    this.engine.settle();
  }


  private services(): FirmwareServices {
    return {
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
        endTransmission: () => {
          const transfer = this.i2c.endTransmission();
          this.engine.settle();
          return transfer.micros;
        },
      },
      spi: {
        begin: () => this.spi.begin(),
        transfer: (value, dataSelect) => this.spi.transfer(value, dataSelect),
        end: () => {
          const transfer = this.spi.end();
          this.engine.settle();
          return transfer.micros;
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
