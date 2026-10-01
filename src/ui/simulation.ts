/**
 * Owns a bench, its circuit, and the firmware running on it.
 *
 * Deliberately a plain class rather than a hook. The bench holds a fully
 * populated breadboard of nearly a thousand terminals, and rebuilding that
 * through React state on every drag frame would be absurd; keeping the mutable
 * model here and letting React re-render from a version counter keeps the
 * expensive work out of the render path entirely.
 */

import { BenchBuilder, type Bench, type PartInstance, type Terminal } from '../sim/bench';
import { Engine } from '../sim/engine';
import { McuRuntime } from '../sim/mcu';
import {
  FirmwareRunner,
  type FirmwareServices,
} from '../sim/firmware/interpreter';
import { FirmwareSyntaxError } from '../sim/firmware/parser';
import type { PartDefinition } from '../sim/catalog';
import { GROUND } from '../sim/elements';
import type { DynamicState } from '../sim/catalog';

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

export const BLINK_SKETCH = `#include <Arduino.h>

#define LED_PIN 2

int blinks = 0;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32 online");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(400);
  digitalWrite(LED_PIN, LOW);
  delay(400);
  blinks++;
  Serial.print("blink ");
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

  routeWire(from: Terminal, to: Terminal): void {
    this.builder.addWire(from.x, from.y, to.x, to.y, {
      colour: pickWireColour(this.bench.wires.length),
    });
    this.rebuild();
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
      if (!this.runner || this.runner.done) break;
      const requested = this.runner.step();
      if (requested === null) break;
      this.advanceBy(Math.min(requested, frameEnd - this.engine.timeMs));
    }

    // Whatever budget the firmware did not use still keeps the circuit
    // resolving, so a paused sketch shows a live, settled bench.
    let guard = 0;
    while (this.engine.timeMs < frameEnd && guard++ < MAX_SLICES_PER_FRAME) {
      const remainingMs = frameEnd - this.engine.timeMs;
      this.engine.step(Math.min(remainingMs, 2) / 1000);
    }
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

    const endTime = this.engine.timeMs + ms;
    let guard = 0;
    while (this.engine.timeMs < endTime && guard++ < 4000) {
      const remaining = endTime - this.engine.timeMs;
      this.engine.step(Math.min(remaining, 2) / 1000);
    }
  }

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
