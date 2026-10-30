/**
 * WebAssembly bridge for the C++ netlist builder (issue #20, phase 2).
 *
 * The host packs the bench into the flat records `netlist.cpp` reads --
 * terminals with positions, parts with pins and resolved knobs, jumpers -- and
 * gets back the terminal-to-net map plus the element list. Pins and knobs are
 * addressed by their TypeScript ids through a string blob, so a part definition
 * stays the single source of truth and a new pin costs no ABI change.
 *
 * The TypeScript `buildNetlist` remains the oracle and the default path. This
 * loader exists so the port is exercised against it on every bench the suite
 * already builds, and so later phases have the netlist behind the same seam as
 * the solver.
 */

import type { Bench } from '../bench';
import type { Netlist, NetInfo } from '../netlist';
import type { ComponentSpec, DynamicState, PinSpec, SensorVariant } from '@/features/parts';
import { DIODE_PROFILES, KEYPAD_KEYS } from '@/features/parts';
import type { DiodeProfile, Element } from '../elements';
import { instantiateEngine, type EngineExports } from './engine';

const TERMINAL_BYTES = 16;
const PIN_BYTES = 12;
const KNOB_BYTES = 32;
const PART_BYTES = 64;
const WIRE_BYTES = 32;
const ELEMENT_BYTES = 32;
const PROFILE_DOUBLES = 7;

/** Component kinds, in the order engine.h lists them. */
const COMPONENT_KIND: Record<ComponentSpec['kind'], number> = {
  resistor: 0,
  led: 1,
  capacitor: 2,
  button: 3,
  potentiometer: 4,
  mcu: 5,
  breadboard: 6,
  display: 7,
  photoresistor: 8,
  thermistor: 9,
  'tilt-switch': 10,
  'slide-switch': 11,
  relay: 12,
  'rotary-encoder': 13,
  sonar: 14,
  stepper: 15,
  'biaxial-stepper': 16,
  dht: 17,
  ds18b20: 18,
  rc522: 19,
  tm1637: 20,
  a4988: 21,
  neopixel: 22,
  'neopixel-matrix': 23,
  'led-ring': 24,
  'ir-remote': 25,
  'rotary-dialer': 26,
  microsd: 27,
  joystick: 28,
  'rgb-led': 29,
  buzzer: 30,
  'sensor-module': 31,
  'dip-switch': 32,
  'slide-potentiometer': 33,
  'led-bar-graph': 34,
  'ir-receiver': 35,
  keypad: 36,
  'i2c-sensor': 37,
  'i2c-expander': 38,
  mcp23017: 39,
  pca9685: 40,
  thermocouple: 41,
  dac: 42,
  'power-supply': 43,
  eeprom: 44,
  'shift-register': 45,
  lcd: 46,
  servo: 47,
  scripted: 48,
  '7segment': 49,
};

/** Sensor-module variants, in `SensorVariant` order. */
const SENSOR_VARIANT: Record<SensorVariant, number> = {
  pir: 0,
  sound: 1,
  soundSmall: 2,
  heartbeat: 3,
  gas: 4,
  flame: 5,
};

const PART_PRESSED = 1;
const PART_RELAY_ENERGIZED = 2;
const PART_SONAR_MEASURING = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface WasmNetlist {
  /** Same contract as `buildNetlist` in ../netlist.ts. */
  build(
    bench: Bench,
    state: DynamicState,
    relayEnergized?: ReadonlyMap<string, boolean>,
    sonarMeasuring?: ReadonlyMap<string, boolean>,
    irTransmitting?: boolean,
    scriptedValues?: ReadonlyMap<string, number>,
  ): Netlist;

  /** Same contract as `buildElements` in ../netlist.ts. */
  buildElements(
    netlist: Netlist,
    timeMs: number,
  ): { elements: Element[]; nodeCount: number };
}

/** Loads the committed wasm artifact. `loadBytes` is the test seam. */
export async function loadWasmNetlist(
  loadBytes?: () => Promise<ArrayBuffer>,
): Promise<WasmNetlist> {
  const exports = await instantiateEngine(loadBytes);
  return new WasmNetlistImpl(exports);
}

interface PinPlan {
  terminal: number;
  nameOffset: number;
  netOffset: number;
}

interface KnobPlan {
  value: number;
  min: number;
  max: number;
  nameOffset: number;
}

interface PartPlan {
  kind: number;
  firstPin: number;
  pinCount: number;
  firstKnob: number;
  knobCount: number;
  flags: number;
  params: [number, number, number, number];
  scripted: number;
}

interface WirePlan {
  from: number;
  to: number;
  idOffset: number;
  gaugeAwg: number;
  lengthMm: number;
}

/** A NUL-terminated string blob with offset 0 reserved for the empty string. */
class StringTable {
  private readonly bytes: number[] = [0];
  private readonly offsets = new Map<string, number>();

  intern(value: string | undefined | null): number {
    if (!value) return 0;
    const existing = this.offsets.get(value);
    if (existing !== undefined) return existing;
    const offset = this.bytes.length;
    for (const byte of encoder.encode(value)) this.bytes.push(byte);
    this.bytes.push(0);
    this.offsets.set(value, offset);
    return offset;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class WasmNetlistImpl implements WasmNetlist {
  private readonly exports: EngineExports;

  private terminalPtr = 0;
  private terminalCapacity = 0;
  private partPtr = 0;
  private partCapacity = 0;
  private pinPtr = 0;
  private pinCapacity = 0;
  private knobPtr = 0;
  private knobCapacity = 0;
  private wirePtr = 0;
  private wireCapacity = 0;
  private groundPtr = 0;
  private groundCapacity = 0;
  private keyPtr = 0;
  private keyCapacity = 0;
  private stringPtr = 0;
  private stringCapacity = 0;
  private profilePtr = 0;
  private profileCapacity = 0;

  constructor(exports: EngineExports) {
    this.exports = exports;
  }

  build(
    bench: Bench,
    state: DynamicState,
    relayEnergized: ReadonlyMap<string, boolean> = new Map(),
    sonarMeasuring: ReadonlyMap<string, boolean> = new Map(),
    irTransmitting = false,
    scriptedValues: ReadonlyMap<string, number> = new Map(),
  ): Netlist {
    bench.terminals.forEach((terminal, index) => {
      if (terminal.id !== index) {
        throw new Error(
          `solver.wasm: terminal ids must be dense, found ${terminal.id} at index ${index}`,
        );
      }
    });

    const strings = new StringTable();
    const profiles: DiodeProfile[] = [
      DIODE_PROFILES.red,
      DIODE_PROFILES.green,
      DIODE_PROFILES.blue,
    ];
    const profileIndex = new Map<DiodeProfile, number>(
      profiles.map((profile, index): [DiodeProfile, number] => [profile, index]),
    );
    const profileFor = (profile: DiodeProfile): number => {
      let index = profileIndex.get(profile);
      if (index === undefined) {
        index = profiles.length;
        profileIndex.set(profile, index);
        profiles.push(profile);
      }
      return index;
    };

    const pins: PinPlan[] = [];
    const knobs: KnobPlan[] = [];
    const parts: PartPlan[] = [];
    const wires: WirePlan[] = [];
    const ground: number[] = [];

    for (const part of bench.parts) {
      const firstPin = pins.length;
      const firstKnob = knobs.length;
      const component = part.definition.component;
      const pinSpecs = new Map<string, PinSpec>(
        part.definition.pins.map((pin): [string, PinSpec] => [pin.id, pin]),
      );

      for (const pinId of Object.keys(part.terminals)) {
        const terminal = part.terminals[pinId];
        this.requireTerminal(terminal, bench.terminals.length, `${part.id}:${pinId}`);
        const spec = pinSpecs.get(pinId);
        pins.push({
          terminal,
          nameOffset: strings.intern(pinId),
          netOffset: strings.intern(spec?.net),
        });
      }

      for (const knob of part.definition.knobs ?? []) {
        knobs.push({
          value: state.knob(part.id, knob),
          min: knob.min,
          max: knob.max,
          nameOffset: strings.intern(knob.id),
        });
      }

      let flags = 0;
      if (state.isPressed(part.id)) flags |= PART_PRESSED;
      if (relayEnergized.get(part.id) ?? false) flags |= PART_RELAY_ENERGIZED;
      if (sonarMeasuring.get(part.id) ?? false) flags |= PART_SONAR_MEASURING;

      parts.push({
        kind: COMPONENT_KIND[component.kind],
        firstPin,
        pinCount: pins.length - firstPin,
        firstKnob,
        knobCount: knobs.length - firstKnob,
        flags,
        params: paramsFor(component, profileFor),
        scripted: scriptedValues.get(part.id) ?? 0,
      });

      if (component.kind === 'mcu') {
        for (const pin of part.definition.boardPins ?? []) {
          if (pin.role !== 'ground') continue;
          const terminal = part.terminals[pin.id];
          if (terminal !== undefined) ground.push(terminal);
        }
      }
    }

    for (const wire of bench.wires) {
      this.requireTerminal(wire.from, bench.terminals.length, `${wire.id}:from`);
      this.requireTerminal(wire.to, bench.terminals.length, `${wire.id}:to`);
      wires.push({
        from: wire.from,
        to: wire.to,
        idOffset: strings.intern(wire.id),
        gaugeAwg: wire.gaugeAwg,
        lengthMm: wire.lengthMm,
      });
    }

    const keyLabels = KEYPAD_KEYS.map((key) => strings.intern(key));
    const stringBytes = strings.finish();

    const terminals = this.allocate(
      this.terminalPtr,
      this.terminalCapacity,
      bench.terminals.length * TERMINAL_BYTES,
    );
    this.terminalPtr = terminals.ptr;
    this.terminalCapacity = terminals.capacity;
    const partBuffer = this.allocate(
      this.partPtr,
      this.partCapacity,
      parts.length * PART_BYTES,
    );
    this.partPtr = partBuffer.ptr;
    this.partCapacity = partBuffer.capacity;
    const pinBuffer = this.allocate(this.pinPtr, this.pinCapacity, pins.length * PIN_BYTES);
    this.pinPtr = pinBuffer.ptr;
    this.pinCapacity = pinBuffer.capacity;
    const knobBuffer = this.allocate(this.knobPtr, this.knobCapacity, knobs.length * KNOB_BYTES);
    this.knobPtr = knobBuffer.ptr;
    this.knobCapacity = knobBuffer.capacity;
    const wireBuffer = this.allocate(this.wirePtr, this.wireCapacity, wires.length * WIRE_BYTES);
    this.wirePtr = wireBuffer.ptr;
    this.wireCapacity = wireBuffer.capacity;
    const groundBuffer = this.allocate(
      this.groundPtr,
      this.groundCapacity,
      ground.length * 4,
    );
    this.groundPtr = groundBuffer.ptr;
    this.groundCapacity = groundBuffer.capacity;
    const keyBuffer = this.allocate(this.keyPtr, this.keyCapacity, keyLabels.length * 4);
    this.keyPtr = keyBuffer.ptr;
    this.keyCapacity = keyBuffer.capacity;
    const stringBuffer = this.allocate(
      this.stringPtr,
      this.stringCapacity,
      stringBytes.length,
    );
    this.stringPtr = stringBuffer.ptr;
    this.stringCapacity = stringBuffer.capacity;
    const profileBuffer = this.allocate(
      this.profilePtr,
      this.profileCapacity,
      profiles.length * PROFILE_DOUBLES * 8,
    );
    this.profilePtr = profileBuffer.ptr;
    this.profileCapacity = profileBuffer.capacity;

    const memory = this.exports.memory.buffer;
    const view = new DataView(memory);

    bench.terminals.forEach((terminal, index) => {
      const base = this.terminalPtr + index * TERMINAL_BYTES;
      view.setFloat64(base, terminal.x, true);
      view.setFloat64(base + 8, terminal.y, true);
    });

    pins.forEach((pin, index) => {
      const base = this.pinPtr + index * PIN_BYTES;
      view.setUint32(base, pin.terminal, true);
      view.setUint32(base + 4, pin.nameOffset, true);
      view.setUint32(base + 8, pin.netOffset, true);
    });

    knobs.forEach((knob, index) => {
      const base = this.knobPtr + index * KNOB_BYTES;
      view.setFloat64(base, knob.value, true);
      view.setFloat64(base + 8, knob.min, true);
      view.setFloat64(base + 16, knob.max, true);
      view.setUint32(base + 24, knob.nameOffset, true);
      view.setUint32(base + 28, 0, true);
    });

    parts.forEach((part, index) => {
      const base = this.partPtr + index * PART_BYTES;
      view.setUint32(base, part.kind, true);
      view.setUint32(base + 4, part.firstPin, true);
      view.setUint32(base + 8, part.pinCount, true);
      view.setUint32(base + 12, part.firstKnob, true);
      view.setUint32(base + 16, part.knobCount, true);
      view.setUint32(base + 20, part.flags, true);
      for (let i = 0; i < 4; i++) view.setFloat64(base + 24 + i * 8, part.params[i], true);
      view.setFloat64(base + 56, part.scripted, true);
    });

    wires.forEach((wire, index) => {
      const base = this.wirePtr + index * WIRE_BYTES;
      view.setUint32(base, wire.from, true);
      view.setUint32(base + 4, wire.to, true);
      view.setUint32(base + 8, wire.idOffset, true);
      view.setUint32(base + 12, 0, true);
      view.setFloat64(base + 16, wire.gaugeAwg, true);
      view.setFloat64(base + 24, wire.lengthMm, true);
    });

    ground.forEach((terminal, index) => {
      view.setUint32(this.groundPtr + index * 4, terminal, true);
    });
    keyLabels.forEach((offset, index) => {
      view.setUint32(this.keyPtr + index * 4, offset, true);
    });
    new Uint8Array(memory, this.stringPtr, stringBytes.length).set(stringBytes);

    const profileView = new Float64Array(
      memory,
      this.profilePtr,
      profiles.length * PROFILE_DOUBLES,
    );
    profiles.forEach((profile, index) => {
      const offset = index * PROFILE_DOUBLES;
      profileView[offset] = profile.forwardVolts;
      profileView[offset + 1] = profile.ratedAmps;
      profileView[offset + 2] = profile.seriesOhms;
      profileView[offset + 3] = profile.ideality;
      profileView[offset + 4] = profile.leakageAmps;
      profileView[offset + 5] = profile.breakdownVolts;
      profileView[offset + 6] = profile.breakdownAmps;
    });
    if (this.exports.set_profiles(this.profilePtr, profiles.length) === 0) {
      throw new Error('solver.wasm: out of memory installing diode profiles');
    }

    const status = this.exports.build_netlist(
      this.terminalPtr,
      bench.terminals.length,
      this.partPtr,
      parts.length,
      this.pinPtr,
      pins.length,
      this.knobPtr,
      knobs.length,
      this.wirePtr,
      wires.length,
      this.groundPtr,
      ground.length,
      this.keyPtr,
      keyLabels.length,
      this.stringPtr,
      stringBytes.length,
      irTransmitting ? 1 : 0,
      0,
      1,
      2,
    );
    if (status !== 0) throw new Error(`solver.wasm: netlist build failed (${status})`);

    const nodeOfTerminal = new Int32Array(bench.terminals.length);
    if (nodeOfTerminal.length > 0) {
      nodeOfTerminal.set(
        new Int32Array(
          this.exports.memory.buffer,
          this.exports.netlist_node_of_terminal(),
          nodeOfTerminal.length,
        ),
      );
    }

    const nodeCount = this.exports.netlist_node_count();
    const terminalsByNode: number[][] = Array.from({ length: nodeCount }, () => []);
    for (let terminal = 0; terminal < nodeOfTerminal.length; terminal++) {
      const node = nodeOfTerminal[terminal];
      if (node >= 0) {
        if (node >= nodeCount) {
          throw new Error(`solver.wasm: terminal ${terminal} mapped to node ${node} of ${nodeCount}`);
        }
        terminalsByNode[node].push(terminal);
      }
    }
    const nets: NetInfo[] = terminalsByNode.map((terminals, index) => ({ index, terminals }));

    const pinNode = new Map<string, number>();
    for (const part of bench.parts) {
      for (const pinId of Object.keys(part.terminals)) {
        pinNode.set(`${part.id}:${pinId}`, nodeOfTerminal[part.terminals[pinId]]);
      }
    }

    const elementCount = this.exports.netlist_element_count();
    const elements: Element[] = [];
    if (elementCount > 0) {
      const elementView = new DataView(
        this.exports.memory.buffer,
        this.exports.netlist_elements(),
        elementCount * ELEMENT_BYTES,
      );
      const labels = new Uint8Array(this.exports.memory.buffer, this.exports.netlist_labels());
      for (let index = 0; index < elementCount; index++) {
        elements.push(this.elementAt(elementView, index * ELEMENT_BYTES, labels, profiles));
      }
    }

    return { nodeOfTerminal, nodeCount, nets, elements, pinNode };
  }

  private elementAt(
    view: DataView,
    offset: number,
    labels: Uint8Array,
    profiles: readonly DiodeProfile[],
  ): Element {
    const kind = view.getInt32(offset, true);
    const a = view.getInt32(offset + 4, true);
    const b = view.getInt32(offset + 8, true);
    const profile = view.getInt32(offset + 12, true);
    const labelOffset = view.getUint32(offset + 16, true);
    const value = view.getFloat64(offset + 24, true);
    const label = labelOffset === 0 ? undefined : readCString(labels, labelOffset);
    const labelPart: { label?: string } = label === undefined ? {} : { label };

    switch (kind) {
      case 0:
        return { kind: 'resistor', a, b, ohms: value, ...labelPart };
      case 1:
        return { kind: 'voltageSource', a, b, volts: value, ...labelPart };
      case 2:
        return { kind: 'currentSource', a, b, amps: value, ...labelPart };
      case 3:
        return { kind: 'capacitor', a, b, farads: value, ...labelPart };
      case 4: {
        const diodeProfile = profiles[profile];
        if (diodeProfile === undefined) {
          throw new Error(`solver.wasm: element ${offset / ELEMENT_BYTES} has unknown profile ${profile}`);
        }
        return { kind: 'diode', a, b, profile: diodeProfile, ...labelPart };
      }
      case 5:
        return { kind: 'ground', node: a };
      default:
        throw new Error(`solver.wasm: unknown element kind ${kind}`);
    }
  }

  private requireTerminal(terminal: number, count: number, context: string): void {
    if (!Number.isInteger(terminal) || terminal < 0 || terminal >= count) {
      throw new Error(`solver.wasm: ${context} names terminal ${terminal}, outside 0..${count - 1}`);
    }
  }

  private allocate(
    ptr: number,
    capacity: number,
    bytes: number,
  ): { ptr: number; capacity: number } {
    if (bytes <= capacity) return { ptr, capacity };
    const next = this.exports.wasm_alloc(bytes);
    if (next === 0) throw new Error('solver.wasm: out of memory');
    return { ptr: next, capacity: bytes };
  }
}

function paramsFor(
  component: ComponentSpec,
  profileFor: (profile: DiodeProfile) => number,
): [number, number, number, number] {
  switch (component.kind) {
    case 'resistor':
    case 'potentiometer':
    case 'slide-potentiometer':
      return [component.ohms, 0, 0, 0];
    case 'capacitor':
      return [component.farads, 0, 0, 0];
    case 'led':
      return [profileFor(component.profile), 0, 0, 0];
    case 'scripted':
      return [component.bus === 'digital' ? 1 : component.bus === 'i2c' ? 2 : 0, 0, 0, 0];
    case 'sensor-module':
      return [SENSOR_VARIANT[component.variant], 0, 0, 0];
    case 'dip-switch':
      return [component.ways, 0, 0, 0];
    case '7segment':
      return [component.digits, 0, 0, 0];
    default:
      return [0, 0, 0, 0];
  }
}

function readCString(bytes: Uint8Array, offset: number): string {
  if (offset >= bytes.length) return '';
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return decoder.decode(bytes.subarray(offset, end));
}
