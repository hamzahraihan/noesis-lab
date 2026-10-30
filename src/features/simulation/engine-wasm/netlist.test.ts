/**
 * Parity gate for issue #20 phase 2: the C++ netlist against `buildNetlist`.
 *
 * Every case asserts the same terminal-to-net map, the same nets and pin map,
 * and the same element list -- including labels and exact element values, so
 * the wire-resistance, thermistor and photoresistor arithmetic is compared bit
 * for bit, not approximately.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DIODE_PROFILES,
  DynamicState,
  NO_DYNAMIC_STATE,
  SENSOR_STIMULUS_KNOBS,
  biaxialStepperDefinition,
  breadboardDefinition,
  buttonDefinition,
  buzzerDefinition,
  capacitorDefinition,
  columnX,
  dhtDefinition,
  dipSwitchDefinition,
  ds18b20Definition,
  encoderDefinition,
  esp32DevKitV1,
  joystickDefinition,
  keypadDefinition,
  ledBarGraphDefinition,
  ledDefinition,
  photoresistorDefinition,
  potentiometerDefinition,
  railRowY,
  relayDefinition,
  resistorDefinition,
  rgbLedDefinition,
  sensorModuleDefinition,
  sevenSegmentDefinition,
  slidePotentiometerDefinition,
  slideSwitchDefinition,
  sonarDefinition,
  stepperDefinition,
  stripRowY,
  thermistorDefinition,
  tiltSwitchDefinition,
  type ComponentSpec,
  type PartDefinition,
  type SensorVariant,
} from '@/features/parts';
import { BenchBuilder, type Bench, type PartInstance } from '../bench';
import type { Element } from '../elements';
import { buildNetlist, type Netlist } from '../netlist';
import { loadWasmNetlist, type WasmNetlist } from './netlist';

let wasm: WasmNetlist;

beforeAll(async () => {
  const buffer = readFileSync('src/features/simulation/engine-wasm/solver.wasm');
  const bytes = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  wasm = await loadWasmNetlist(async () => bytes);
});

function compare(
  bench: Bench,
  state: DynamicState,
  relayEnergized: ReadonlyMap<string, boolean> = new Map(),
  sonarMeasuring: ReadonlyMap<string, boolean> = new Map(),
  irTransmitting = false,
  scriptedValues: ReadonlyMap<string, number> = new Map(),
): Netlist {
  const oracle = buildNetlist(bench, state, relayEnergized, sonarMeasuring, irTransmitting, scriptedValues);
  const port = wasm.build(bench, state, relayEnergized, sonarMeasuring, irTransmitting, scriptedValues);

  expect(port.nodeCount, 'nodeCount').toBe(oracle.nodeCount);
  expect(Array.from(port.nodeOfTerminal), 'nodeOfTerminal').toEqual(
    Array.from(oracle.nodeOfTerminal),
  );

  expect(port.nets.length, 'net count').toBe(oracle.nets.length);
  for (let index = 0; index < oracle.nets.length; index++) {
    expect(port.nets[index].index, `net ${index} index`).toBe(oracle.nets[index].index);
    expect(port.nets[index].terminals, `net ${index} terminals`).toEqual(
      oracle.nets[index].terminals,
    );
  }

  expect(port.pinNode.size, 'pin count').toBe(oracle.pinNode.size);
  for (const [key, node] of oracle.pinNode) {
    expect(port.pinNode.get(key), `pin ${key}`).toBe(node);
  }

  expectElements(port.elements, oracle.elements);
  return port;
}

function expectElements(actual: readonly Element[], expected: readonly Element[]): void {
  expect(actual.length, 'element count').toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    const port = actual[index];
    const oracle = expected[index];
    const label = 'label' in oracle ? ` ${oracle.label}` : '';
    const context = `element ${index} (${oracle.kind}${label})`;
    expect(port.kind, `${context} kind`).toBe(oracle.kind);
    expect('label' in port ? port.label : undefined, `${context} label`).toBe(
      'label' in oracle ? oracle.label : undefined,
    );

    switch (oracle.kind) {
      case 'resistor': {
        if (port.kind !== 'resistor') throw new Error(`${context} is not a resistor`);
        expect(port.a, `${context} a`).toBe(oracle.a);
        expect(port.b, `${context} b`).toBe(oracle.b);
        expect(port.ohms, `${context} ohms`).toBe(oracle.ohms);
        break;
      }
      case 'capacitor': {
        if (port.kind !== 'capacitor') throw new Error(`${context} is not a capacitor`);
        expect(port.a, `${context} a`).toBe(oracle.a);
        expect(port.b, `${context} b`).toBe(oracle.b);
        expect(port.farads, `${context} farads`).toBe(oracle.farads);
        break;
      }
      case 'diode': {
        if (port.kind !== 'diode') throw new Error(`${context} is not a diode`);
        expect(port.a, `${context} a`).toBe(oracle.a);
        expect(port.b, `${context} b`).toBe(oracle.b);
        expect(port.profile, `${context} profile`).toBe(oracle.profile);
        break;
      }
      default:
        throw new Error(`netlist emitted an unexpected ${oracle.kind} element`);
    }
  }
}

const BOARD_ORIGIN_X = 200;
const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

function pinAt(part: PartInstance, id: string) {
  return part.definition.pins.find((pin) => pin.id === id)!;
}

function breadboardBench(): { builder: BenchBuilder; esp32: PartInstance } {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  return { builder, esp32 };
}

function ledBench(): Bench {
  const { builder, esp32 } = breadboardBench();
  const gpio2 = pinAt(esp32, 'R_D2');
  builder.addWire(gpio2.x, gpio2.y, holeX(20), holeY(8));

  builder.addPart(resistorDefinition(330), holeX(20), holeY(8) - 2.54);

  const ledDef = ledDefinition(DIODE_PROFILES.red, 'Red');
  const ledAnode = ledDef.pins.find((pin) => pin.id === 'anode')!;
  builder.addPart(ledDef, holeX(24) - ledAnode.x, holeY(8) - ledAnode.y);

  builder.addWire(holeX(23), holeY(8), holeX(23), railRowY(2));
  const ground = pinAt(esp32, 'L_GND');
  builder.addWire(ground.x, ground.y, holeX(10), railRowY(2));
  return builder.build();
}

function scriptedDefinition(bus: 'analog' | 'digital'): PartDefinition {
  const component: ComponentSpec =
    bus === 'digital' ? { kind: 'scripted', bus: 'digital' } : { kind: 'scripted', bus: 'analog' };
  return {
    id: `scripted-${bus}`,
    name: `Scripted ${bus}`,
    category: 'input',
    widthMm: 20,
    heightMm: 12,
    component,
    pins: [
      { id: bus === 'digital' ? 'DOUT' : 'AOUT', label: 'OUT', x: 0, y: 6 },
      { id: 'VCC', label: 'VCC', x: 10, y: 6 },
      { id: 'GND', label: 'GND', x: 20, y: 6 },
    ],
    bodyColour: '#5b6b4a',
    legendColour: '#f2f2ee',
  };
}

function setKnob(state: DynamicState, part: PartInstance, id: string, value: number): void {
  const knob = part.definition.knobs?.find((candidate) => candidate.id === id);
  if (knob) state.setKnob(part.id, knob, value);
}

function coverageBench(): {
  bench: Bench;
  state: DynamicState;
  relay: ReadonlyMap<string, boolean>;
  sonar: ReadonlyMap<string, boolean>;
  ir: boolean;
  scripted: ReadonlyMap<string, number>;
} {
  const builder = new BenchBuilder();
  builder.addPart(esp32DevKitV1(), 0, 0);
  const state = new DynamicState();
  const relay = new Map<string, boolean>();
  const sonar = new Map<string, boolean>();
  const scripted = new Map<string, number>();

  let x = 200;
  let y = 200;
  const add = (definition: PartDefinition): PartInstance => {
    const part = builder.addPart(definition, x, y);
    for (const knob of definition.knobs ?? []) state.setKnob(part.id, knob, knob.defaultValue);
    x += 200;
    if (x > 1000) {
      x = 200;
      y += 200;
    }
    return part;
  };

  add(resistorDefinition(1000));
  add(ledDefinition(DIODE_PROFILES.red, 'Red'));
  add(capacitorDefinition(1e-6));

  const pressedButton = add(buttonDefinition());
  state.setPressed(pressedButton.id, true);
  add(buttonDefinition());

  const pot = add(potentiometerDefinition(10_000));
  setKnob(state, pot, 'turn', 0.25);
  const slidePot = add(slidePotentiometerDefinition(10_000));
  setKnob(state, slidePot, 'turn', 0.75);

  const ldr = add(photoresistorDefinition());
  setKnob(state, ldr, 'light', 500);
  setKnob(state, ldr, 'threshold', 30);
  const thermistor = add(thermistorDefinition());
  setKnob(state, thermistor, 'temperature', 60);

  const tilted = add(tiltSwitchDefinition());
  setKnob(state, tilted, 'tilted', 1);
  const slide = add(slideSwitchDefinition());
  setKnob(state, slide, 'closed', 1);

  const joystick = add(joystickDefinition());
  setKnob(state, joystick, 'horizontal', 0.25);
  setKnob(state, joystick, 'vertical', 0.75);
  state.setPressed(joystick.id, true);

  add(rgbLedDefinition());
  add(ledBarGraphDefinition());
  add(sevenSegmentDefinition(1));
  add(sevenSegmentDefinition(2));
  add(sevenSegmentDefinition(4));
  add(buzzerDefinition());

  for (const variant of Object.keys(SENSOR_STIMULUS_KNOBS) as SensorVariant[]) {
    const module = add(sensorModuleDefinition(variant));
    const stimulus = SENSOR_STIMULUS_KNOBS[variant];
    setKnob(state, module, stimulus.id, (stimulus.min + stimulus.max) / 2);
    setKnob(state, module, 'threshold', 25);
  }

  const dip = add(dipSwitchDefinition());
  setKnob(state, dip, 'dip1', 1);
  setKnob(state, dip, 'dip8', 1);
  const keypad = add(keypadDefinition());
  setKnob(state, keypad, 'key1', 1);
  setKnob(state, keypad, 'key16', 1);

  const energizedRelay = add(relayDefinition());
  relay.set(energizedRelay.id, true);
  add(relayDefinition());

  add(stepperDefinition());
  add(biaxialStepperDefinition());

  const turnedEncoder = add(encoderDefinition());
  setKnob(state, turnedEncoder, 'detent', 1);
  const pressedEncoder = add(encoderDefinition());
  state.setPressed(pressedEncoder.id, true);

  const measuringSonar = add(sonarDefinition());
  sonar.set(measuringSonar.id, true);
  add(sonarDefinition());

  add(dhtDefinition());
  add(ds18b20Definition());

  const analog = add(scriptedDefinition('analog'));
  scripted.set(analog.id, 0.25);
  const digital = add(scriptedDefinition('digital'));
  scripted.set(digital.id, 1);

  return { bench: builder.build(), state, relay, sonar, ir: true, scripted };
}

describe('C++ netlist parity: fixed benches', () => {
  it('extracts an unwired breadboard and board', () => {
    const { builder } = breadboardBench();
    compare(builder.build(), NO_DYNAMIC_STATE);
  });

  it('extracts the LED chain through a breadboard', () => {
    compare(ledBench(), NO_DYNAMIC_STATE);
  });

  it('covers every element-emitting component kind', () => {
    const { bench, state, relay, sonar, ir, scripted } = coverageBench();
    compare(bench, state, relay, sonar, ir, scripted);
  });
});

describe('C++ netlist parity: randomized benches', () => {
  it('matches the oracle on 60 generated benches', () => {
    const random = mulberry32(0x20_10_20_26);
    for (let caseIndex = 0; caseIndex < 60; caseIndex++) {
      const { bench, state, relay, sonar, ir, scripted } = randomBench(random);
      compare(bench, state, relay, sonar, ir, scripted);
    }
  });
});

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

function randomBench(random: () => number): {
  bench: Bench;
  state: DynamicState;
  relay: ReadonlyMap<string, boolean>;
  sonar: ReadonlyMap<string, boolean>;
  ir: boolean;
  scripted: ReadonlyMap<string, number>;
} {
  const builder = new BenchBuilder();
  builder.addPart(esp32DevKitV1(), 0, 0);
  const state = new DynamicState();
  const relay = new Map<string, boolean>();
  const sonar = new Map<string, boolean>();
  const scripted = new Map<string, number>();

  const factories: ReadonlyArray<() => PartDefinition> = [
    () => resistorDefinition(10 ** (random() * 6)),
    () => ledDefinition(pick(Object.values(DIODE_PROFILES), random), 'LED'),
    () => capacitorDefinition(10 ** (-9 + random() * 6)),
    buttonDefinition,
    () => potentiometerDefinition(10_000),
    () => slidePotentiometerDefinition(10_000),
    photoresistorDefinition,
    thermistorDefinition,
    tiltSwitchDefinition,
    slideSwitchDefinition,
    joystickDefinition,
    rgbLedDefinition,
    ledBarGraphDefinition,
    () => sevenSegmentDefinition(pick([1, 2, 3, 4] as const, random)),
    buzzerDefinition,
    () => sensorModuleDefinition(pick(Object.keys(SENSOR_STIMULUS_KNOBS) as SensorVariant[], random)),
    dipSwitchDefinition,
    keypadDefinition,
    relayDefinition,
    stepperDefinition,
    biaxialStepperDefinition,
    encoderDefinition,
    sonarDefinition,
    dhtDefinition,
    ds18b20Definition,
    () => scriptedDefinition(random() < 0.5 ? 'analog' : 'digital'),
  ];

  const count = Math.floor(random() * 8);
  for (let index = 0; index < count; index++) {
    const definition = factories[Math.floor(random() * factories.length)]();
    const part = builder.addPart(
      definition,
      random() * 400,
      random() * 400,
      pick([0, 90, 180, 270] as const, random),
    );
    for (const knob of definition.knobs ?? []) {
      if (random() < 0.5) {
        state.setKnob(part.id, knob, knob.min + random() * (knob.max - knob.min));
      }
    }
    if (definition.momentary && random() < 0.5) state.setPressed(part.id, true);
    if (definition.component.kind === 'relay') relay.set(part.id, random() < 0.5);
    if (definition.component.kind === 'sonar') sonar.set(part.id, random() < 0.5);
    if (definition.component.kind === 'scripted') scripted.set(part.id, random() * 1.4 - 0.2);
  }

  const terminals = builder.build().terminals;
  const wireCount = Math.floor(random() * 6);
  for (let index = 0; index < wireCount; index++) {
    const from = terminals[Math.floor(random() * terminals.length)];
    const to = terminals[Math.floor(random() * terminals.length)];
    builder.addWire(from.x, from.y, to.x, to.y, {
      gaugeAwg: pick([22, 26, 30] as const, random),
    });
  }

  return { bench: builder.build(), state, relay, sonar, ir: random() < 0.5, scripted };
}
