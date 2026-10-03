/**
 * Netlist extraction: bench geometry in, solvable circuit out.
 *
 * The whole job is union-find. Anything that physically joins two terminals --
 * a jumper, a breadboard strip, a microcontroller's ground plane, two leads
 * pushed into one hole -- unions them, and the resulting sets are the nets.
 * Element emission is a second, mechanical pass over the parts once the nets
 * are numbered.
 *
 * Choosing ground matters more than it looks. The solver needs one node pinned
 * to 0 V, and picking an arbitrary net would silently shift every reading. The
 * reference is therefore always a real ground pin on a board, so a bench with
 * no ground reference is reported rather than quietly solved against the wrong
 * datum.
 */

import { DIODE_PROFILES, GROUND, type DiodeProfile, type Element } from './elements';
import { wireResistanceOhms } from './units';
import { SNAP_DISTANCE_MM, type Bench, type PartInstance } from './bench';
import type { DynamicState } from './catalog';
import { RELAY_COIL_OHMS } from './relay';
import { WIPER_KNOB } from './passives';
import { DETENT_KNOB, quadratureAt } from './encoder';
import {
  COMPARATOR_THRESHOLD_KNOB,
  DIP_WAY_KNOBS,
  HORIZONTAL_KNOB,
  IR_CODE_KNOB,
  KEYPAD_COLUMNS,
  KEYPAD_KEY_KNOBS,
  LED_BAR_GRAPH_SEGMENTS,
  LIGHT_KNOB,
  SEVEN_SEGMENT_SEGMENTS,
  SENSOR_STIMULUS_KNOBS,
  SLIDE_POSITION_KNOB,
  TEMPERATURE_KNOB,
  TILTED_KNOB,
  VERTICAL_KNOB,
} from './modules';

export interface NetInfo {
  readonly index: number;
  readonly terminals: readonly number[];
}

export interface Netlist {
  /** Net index for each terminal; `GROUND` (-1) for the reference net. */
  readonly nodeOfTerminal: Int32Array;
  readonly nodeCount: number;
  readonly nets: readonly NetInfo[];
  readonly elements: readonly Element[];
  /** `partId:pinId` to net index. */
  readonly pinNode: ReadonlyMap<string, number>;
}

/** A tactile switch's open contact. High, but low enough to outvote gmin. */
const SWITCH_OPEN_OHMS = 1e9;

/**
 * A GL5528's resistance at the ends of its range: about 50 k in near-darkness
 * and 3.5 k in daylight. The curve between them is logarithmic, which is why
 * the light knob is in lux and not in per cent.
 */
const LDR_DARK_OHMS = 50_000;
const LDR_BRIGHT_OHMS = 3_500;

/** Closed contact resistance of a tactile switch. */
const SWITCH_CLOSED_OHMS = 0.05;
/** Keeps a potentiometer at either end from producing an infinite conductance. */
const MIN_POT_SEGMENT_OHMS = 0.1;

/** The fixed resistor on a sensor module, which is what makes it a divider. */
const MODULE_DIVIDER_OHMS = 10_000;
/** Pull-up on a module's open-drain output, and on the joystick's select pin. */
const MODULE_PULLUP_OHMS = 10_000;

/** What an open-drain output measures against when it is pulling the line low. */
const OPEN_DRAIN_SINK_OHMS = 1_000;

/**
 * The sensor's resistance on a comparator board with nothing to report.
 *
 * Nothing on the board pulls the analogue pin down but its own divider, so the
 * sensor leg is left effectively open. A megohm is what puts AOUT on the bottom
 * rail rather than floating, which is where the pin idles until the sensor has
 * something to say.
 */
const SENSOR_IDLE_OHMS = 1e6;

/**
 * The sensor's resistance at full stimulus, which is the board's own divider
 * value.
 *
 * Equal to `MODULE_DIVIDER_OHMS` on purpose: at maximum stimulus the analogue
 * output then sits at exactly half the supply, which is where
 * `COMPARATOR_THRESHOLD_KNOB` starts out. So the trimmer reads the same on all
 * five boards -- half way up whatever range that board reports in.
 */
const SENSOR_FULL_SCALE_OHMS = 10_000;

/** An NTC's resistance at 25 C, its beta constant, and that temperature in K. */
const NTC_OHMS_AT_25C = 10_000;
const NTC_BETA_K = 3950;
const KELVIN_AT_25C = 273.15 + 25;

/** A joystick's axis pot, the same 10 k the module ships with. */
const JOYSTICK_AXIS_OHMS = 10_000;

/** A piezo disc's capacitance, and the leakage that keeps it off an open circuit. */
const PIEZO_FARADS = 100e-9;
const PIEZO_LEAKAGE_OHMS = 1e6;

class DisjointSet {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(node: number): number {
    let root = node;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression on the way back.
    let walker = node;
    while (this.parent[walker] !== root) {
      const next = this.parent[walker];
      this.parent[walker] = root;
      walker = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) {
      const swap = rootA;
      rootA = rootB;
      rootB = swap;
    }
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA]++;
  }
}

/**
 * Joins contacts that are sitting in the same hole.
 *
 * Two leads pushed into one breadboard column hold two contacts at one
 * coordinate, and nothing but geometry says they are joined. Bucketing on the
 * snap distance keeps this linear -- every contact only has to look at the
 * nine cells around it -- which matters because a drag re-extracts the whole
 * netlist on every pointer move.
 */
function unionCoincidentContacts(bench: Bench, sets: DisjointSet): void {
  const cells = new Map<string, number[]>();
  const snapSquared = SNAP_DISTANCE_MM * SNAP_DISTANCE_MM;

  for (const terminal of bench.terminals) {
    const cellX = Math.floor(terminal.x / SNAP_DISTANCE_MM);
    const cellY = Math.floor(terminal.y / SNAP_DISTANCE_MM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbours = cells.get(`${cellX + dx},${cellY + dy}`);
        if (!neighbours) continue;
        for (const other of neighbours) {
          const contact = bench.terminals[other];
          const gapX = contact.x - terminal.x;
          const gapY = contact.y - terminal.y;
          if (gapX * gapX + gapY * gapY <= snapSquared) sets.union(other, terminal.id);
        }
      }
    }
    const key = `${cellX},${cellY}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(terminal.id);
    else cells.set(key, [terminal.id]);
  }
}

/**
 * Picks the reference net: the root containing any board ground pin.
 *
 * Returns `GROUND` when the bench has no ground at all, which callers surface
 * as "no reference" rather than solving against an arbitrary datum.
 */
function chooseGroundRoot(
  bench: Bench,
  sets: DisjointSet,
): number {
  for (const part of bench.parts) {
    if (part.definition.component.kind !== 'mcu') continue;
    for (const pin of part.definition.boardPins ?? []) {
      if (pin.role !== 'ground') continue;
      const terminal = part.terminals[pin.id];
      if (terminal !== undefined) return sets.find(terminal);
    }
  }
  return GROUND;
}

function elementsForPart(
  part: PartInstance,
  pinNode: ReadonlyMap<string, number>,
  state: DynamicState,
  relayEnergized: ReadonlyMap<string, boolean> = new Map(),
): Element[] {
  const nodeAt = (pinId: string): number => pinNode.get(`${part.id}:${pinId}`) ?? GROUND;
  const component = part.definition.component;

  /*
   * A pot as the two resistors its wiper sits between. The same pair serves a
   * discrete potentiometer and each of a joystick's axes, which is why it is
   * pulled out rather than written twice.
   */
  const potLegs = (
    endA: string,
    wiper: string,
    endB: string,
    ohms: number,
    turn: number,
  ): Element[] => [
    {
      kind: 'resistor',
      a: nodeAt(endA),
      b: nodeAt(wiper),
      ohms: Math.max(MIN_POT_SEGMENT_OHMS, ohms * turn),
    },
    {
      kind: 'resistor',
      a: nodeAt(wiper),
      b: nodeAt(endB),
      ohms: Math.max(MIN_POT_SEGMENT_OHMS, ohms * (1 - turn)),
    },
  ];

  /*
   * A board that reports by pulling its output line to ground, with a pull-up
   * to its own supply over the top of it. A comparator's open-drain leg and a
   * receiver's decoded carrier both arrive at exactly this, which is why the
   * line reads high until something pulls it down: a sketch that treats it as
   * active-high sees the polarity of the board rather than its own.
   */
  const openDrainOutput = (pin: string, sinking: boolean): Element[] => [
    {
      kind: 'resistor',
      a: nodeAt(pin),
      b: nodeAt('GND'),
      ohms: sinking ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
      label: sinking ? 'closed' : 'open',
    },
    {
      kind: 'resistor',
      a: nodeAt(pin),
      b: nodeAt('VCC'),
      ohms: MODULE_PULLUP_OHMS,
      label: 'pull-up',
    },
  ];

  switch (component.kind) {
    case 'resistor':
      return [{ kind: 'resistor', a: nodeAt('a'), b: nodeAt('b'), ohms: component.ohms }];

    case 'led':
      return [
        {
          kind: 'diode',
          a: nodeAt('anode'),
          b: nodeAt('cathode'),
          profile: component.profile as DiodeProfile,
        },
      ];

    case 'capacitor':
      return [
        {
          kind: 'capacitor',
          a: nodeAt('positive'),
          b: nodeAt('negative'),
          farads: component.farads,
        },
      ];

    case 'button': {
      const closed = state.isPressed(part.id);
      return [
        {
          kind: 'resistor',
          a: nodeAt('a'),
          b: nodeAt('b'),
          ohms: closed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: closed ? 'closed' : 'open',
        },
      ];
    }

    case 'potentiometer':
      return [...potLegs('endA', 'wiper', 'endB', component.ohms, state.knob(part.id, WIPER_KNOB))];

    /*
     * The same divider with its travel turned sideways. It has a kind of its
     * own only so that the renderer can tell the two pots' artwork apart; the
     * circuit and the control are the rotary pot's.
     */
    case 'slide-potentiometer':
      return [...potLegs('endA', 'wiper', 'endB', component.ohms, state.knob(part.id, WIPER_KNOB))];

    case 'photoresistor': {
      const light = state.knob(part.id, LIGHT_KNOB) / LIGHT_KNOB.max;
      /*
       * A photoresistor's resistance falls roughly logarithmically with light,
       * so the two datasheet figures are joined through the log of the ratio
       * rather than in a straight line between them.
       */
      const sensorOhms = LDR_DARK_OHMS * (LDR_BRIGHT_OHMS / LDR_DARK_OHMS) ** light;
      // The fraction of the supply the divider sits at, which is what the
      // on-board comparator measures the output against.
      const dividerFraction = sensorOhms / (sensorOhms + MODULE_DIVIDER_OHMS);
      const elements: Element[] = [
        { kind: 'resistor', a: nodeAt('VCC'), b: nodeAt('AO'), ohms: sensorOhms, label: 'sensor' },
        {
          kind: 'resistor',
          a: nodeAt('AO'),
          b: nodeAt('GND'),
          ohms: MODULE_DIVIDER_OHMS,
          label: 'divider',
        },
        {
          kind: 'resistor',
          a: nodeAt('DO'),
          b: nodeAt('VCC'),
          ohms: MODULE_PULLUP_OHMS,
          label: 'pull-up',
        },
      ];
      /*
       * DO is the on-board comparator's open-drain output: it holds the line
       * at the supply until the divider passes the trimmer, then pulls it down
       * through the output's own impedance.
       */
      const tripped =
        dividerFraction > state.knob(part.id, COMPARATOR_THRESHOLD_KNOB) / 100;
      if (tripped) {
        elements.push({
          kind: 'resistor',
          a: nodeAt('DO'),
          b: nodeAt('GND'),
          ohms: OPEN_DRAIN_SINK_OHMS,
          label: 'comparator',
        });
      }
      return elements;
    }

    case 'thermistor': {
      const celsius = state.knob(part.id, TEMPERATURE_KNOB);
      const kelvin = KELVIN_AT_25C + (celsius - 25);
      const ohms =
        NTC_OHMS_AT_25C * Math.exp(NTC_BETA_K * (1 / kelvin - 1 / KELVIN_AT_25C));
      return [
        { kind: 'resistor', a: nodeAt('VCC'), b: nodeAt('OUT'), ohms, label: 'thermistor' },
        {
          kind: 'resistor',
          a: nodeAt('OUT'),
          b: nodeAt('GND'),
          ohms: MODULE_DIVIDER_OHMS,
          label: 'divider',
        },
      ];
    }

    /*
     * The tilt switch and the IR receiver are the same board as far as a solver
     * is concerned: a contact to ground under a pull-up to the supply, with
     * the stimulus -- a tilt or an arriving code -- deciding which state it is
     * in.
     */
    case 'tilt-switch':
      return openDrainOutput('OUT', state.knob(part.id, TILTED_KNOB) >= 0.5);

    case 'ir-receiver':
      return openDrainOutput('DAT', state.knob(part.id, IR_CODE_KNOB) >= 0.5);

    case 'slide-switch': {
      const thrownToOne = state.knob(part.id, SLIDE_POSITION_KNOB) >= 0.5;
      const closedTo = thrownToOne ? '1' : '3';
      const openTo = thrownToOne ? '3' : '1';
      return [
        {
          kind: 'resistor',
          a: nodeAt('2'),
          b: nodeAt(closedTo),
          ohms: SWITCH_CLOSED_OHMS,
          label: 'closed',
        },
        {
          kind: 'resistor',
          a: nodeAt('2'),
          b: nodeAt(openTo),
          ohms: SWITCH_OPEN_OHMS,
          label: 'open',
        },
      ];
    }

    case 'joystick': {
      const held = state.isPressed(part.id);
      return [
        /*
         * Each axis runs ground-to-supply, so the far end of the stick reads
         * high. That is also the way the artwork reads: the element takes its
         * position as a step from centre, left and up being positive.
         */
        ...potLegs('GND', 'HORZ', 'VCC', JOYSTICK_AXIS_OHMS, state.knob(part.id, HORIZONTAL_KNOB)),
        ...potLegs('GND', 'VERT', 'VCC', JOYSTICK_AXIS_OHMS, state.knob(part.id, VERTICAL_KNOB)),
        {
          kind: 'resistor',
          a: nodeAt('SEL'),
          b: nodeAt('GND'),
          ohms: held ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: held ? 'closed' : 'open',
        },
        {
          kind: 'resistor',
          a: nodeAt('SEL'),
          b: nodeAt('VCC'),
          ohms: MODULE_PULLUP_OHMS,
          label: 'pull-up',
        },
      ];
    }

    case 'rgb-led':
      return [
        { kind: 'diode', a: nodeAt('red'), b: nodeAt('common'), profile: DIODE_PROFILES.red },
        { kind: 'diode', a: nodeAt('green'), b: nodeAt('common'), profile: DIODE_PROFILES.green },
        { kind: 'diode', a: nodeAt('blue'), b: nodeAt('common'), profile: DIODE_PROFILES.blue },
      ];

    /*
     * Ten dice, each with its own anode and its own cathode out to the edge:
     * that is what a bar graph is, and why lighting a level on one takes two
     * wires rather than a single common.
     */
    case 'led-bar-graph': {
      const elements: Element[] = [];
      for (let segment = 1; segment <= LED_BAR_GRAPH_SEGMENTS; segment++) {
        elements.push({
          kind: 'diode',
          a: nodeAt(`A${segment}`),
          b: nodeAt(`C${segment}`),
          profile: DIODE_PROFILES.red,
        });
      }
      return elements;
    }

    /*
     * A multiplexed display: each segment is one diode between the digit's
     * common and its own line, so what lights a segment is which of the two is
     * held where rather than the voltage on one wire. Both commons are the same
     * electrode, joined in the part definition rather than here.
     */
    case '7segment': {
      const elements: Element[] = [];
      for (const segment of SEVEN_SEGMENT_SEGMENTS) {
        elements.push({
          kind: 'diode',
          a: nodeAt('COM.1'),
          b: nodeAt(segment),
          profile: DIODE_PROFILES.red,
        });
      }
      return elements;
    }

    case 'buzzer':
      return [
        {
          kind: 'capacitor',
          a: nodeAt('positive'),
          b: nodeAt('negative'),
          farads: PIEZO_FARADS,
        },
        {
          kind: 'resistor',
          a: nodeAt('positive'),
          b: nodeAt('negative'),
          ohms: PIEZO_LEAKAGE_OHMS,
          label: 'leakage',
        },
      ];

    /*
     * One case for the whole comparator sensor family, because the circuit is
     * the same on all five: a sensor and the board's own divider feeding an
     * LM393, whose open-drain output is pulled up to the supply and only sinks
     * the line once the stimulus is past the trimmer.
     */
    case 'sensor-module': {
      const stimulus = SENSOR_STIMULUS_KNOBS[component.variant];
      // Normalised against the knob's own range, so a board that reports 0-100
      // dB and one that reports 0 or 1 land in the same place.
      const level = state.knob(part.id, stimulus) / stimulus.max;
      const elements: Element[] = [];

      /*
       * The sensor's leg of the divider falls as the stimulus rises, so the
       * analogue output climbs with it -- joined through the log of the ratio,
       * the same curve the photoresistor's is. The two three-pin boards bring
       * no analogue tap out, and have no divider to bring it out of.
       */
      if (part.terminals.AOUT !== undefined) {
        const sensorOhms =
          SENSOR_IDLE_OHMS * (SENSOR_FULL_SCALE_OHMS / SENSOR_IDLE_OHMS) ** level;
        elements.push(
          { kind: 'resistor', a: nodeAt('VCC'), b: nodeAt('AOUT'), ohms: sensorOhms, label: 'sensor' },
          {
            kind: 'resistor',
            a: nodeAt('AOUT'),
            b: nodeAt('GND'),
            ohms: MODULE_DIVIDER_OHMS,
            label: 'divider',
          },
        );
      }

      elements.push({
        kind: 'resistor',
        a: nodeAt('DOUT'),
        b: nodeAt('VCC'),
        ohms: MODULE_PULLUP_OHMS,
        label: 'pull-up',
      });

      /*
       * The comparator sits between the sensor's signal and the trimmer, so its
       * trip point is a place on the stimulus scale rather than a voltage. That
       * is also what lets one threshold knob mean the same thing on all five:
       * half way up the light range on one board, half way up the sound range
       * on the next.
       */
      if (level > state.knob(part.id, COMPARATOR_THRESHOLD_KNOB) / COMPARATOR_THRESHOLD_KNOB.max) {
        elements.push({
          kind: 'resistor',
          a: nodeAt('DOUT'),
          b: nodeAt('GND'),
          ohms: OPEN_DRAIN_SINK_OHMS,
          label: 'comparator',
        });
      }
      return elements;
    }

    /*
     * The DIP switch is eight independent latching contacts and nothing else:
     * no bus across the package, and no supply of its own, so a way is closed
     * between its own two pins or it is the gap a rocker switch leaves.
     */
    case 'dip-switch': {
      const elements: Element[] = [];
      for (const [index, spec] of DIP_WAY_KNOBS.entries()) {
        if (index >= component.ways) break;
        const way = index + 1;
        const closed = state.knob(part.id, spec) >= 0.5;
        elements.push({
          kind: 'resistor',
          a: nodeAt(`${way}a`),
          b: nodeAt(`${way}b`),
          ohms: closed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: `way ${way} ${closed ? 'closed' : 'open'}`,
        });
      }
      return elements;
    }

    /*
     * Sixteen contacts and no bus: each one joins a row to a column and nothing
     * else, which is the whole reason four outputs are enough to read sixteen
     * keys. A column with no key down on the scanned row is whatever the
     * sketch's own pull-up holds it at.
     */
    case 'keypad': {
      const elements: Element[] = [];
      for (const [index, spec] of KEYPAD_KEY_KNOBS.entries()) {
        const row = Math.floor(index / KEYPAD_COLUMNS) + 1;
        const column = (index % KEYPAD_COLUMNS) + 1;
        const pressed = state.knob(part.id, spec) >= 0.5;
        elements.push({
          kind: 'resistor',
          a: nodeAt(`R${row}`),
          b: nodeAt(`C${column}`),
          ohms: pressed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: `${spec.label} ${pressed ? 'closed' : 'open'}`,
        });
      }
      return elements;
    }

    case 'relay': {
      // One coil across COIL+/COIL-, two poles ganged. Energized state comes
      // from the engine (which solved the coil volts last tick) because the
      // netlist is built before solving -- reading volts here would be the
      // answer to this same solve. Absent state rests on NC, never shorting.
      const energized = relayEnergized.get(part.id) ?? false;
      const pole = (poleId: string, noId: string, ncId: string): Element[] => [
        {
          kind: 'resistor',
          a: nodeAt(poleId),
          b: nodeAt(energized ? noId : ncId),
          ohms: SWITCH_CLOSED_OHMS,
          label: energized ? 'closed' : 'closed',
        },
        {
          kind: 'resistor',
          a: nodeAt(poleId),
          b: nodeAt(energized ? ncId : noId),
          ohms: SWITCH_OPEN_OHMS,
          label: 'open',
        },
      ];
      return [
        {
          kind: 'resistor',
          a: nodeAt('COIL+'),
          b: nodeAt('COIL-'),
          ohms: RELAY_COIL_OHMS,
          label: 'coil',
        },
        ...pole('P1', 'NO1', 'NC1'),
        ...pole('P2', 'NO2', 'NC2'),
      ];
    }

    case 'rotary-encoder': {
      // Board pull-ups hold CLK/DT high; the detent knob walks the Gray
      // cycle so digitalRead sees valid quadrature. SW shorts to ground
      // while held, same shape as the joystick select contact.
      const [clk, dt] = quadratureAt(state.knob(part.id, DETENT_KNOB));
      const pressed = state.isPressed(part.id);
      return [
        {
          kind: 'resistor',
          a: nodeAt('CLK'),
          b: nodeAt('GND'),
          ohms: clk === 0 ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: clk === 0 ? 'closed' : 'open',
        },
        {
          kind: 'resistor',
          a: nodeAt('CLK'),
          b: nodeAt('VCC'),
          ohms: MODULE_PULLUP_OHMS,
          label: 'pull-up',
        },
        {
          kind: 'resistor',
          a: nodeAt('DT'),
          b: nodeAt('GND'),
          ohms: dt === 0 ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: dt === 0 ? 'closed' : 'open',
        },
        {
          kind: 'resistor',
          a: nodeAt('DT'),
          b: nodeAt('VCC'),
          ohms: MODULE_PULLUP_OHMS,
          label: 'pull-up',
        },
        {
          kind: 'resistor',
          a: nodeAt('SW'),
          b: nodeAt('GND'),
          ohms: pressed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label: pressed ? 'closed' : 'open',
        },
        {
          kind: 'resistor',
          a: nodeAt('SW'),
          b: nodeAt('VCC'),
          ohms: MODULE_PULLUP_OHMS,
          label: 'pull-up',
        },
      ];
    }

    case 'sonar':
      // Full echo-line emission lands in Task 2; resting stub keeps the
      // switch exhaustive until then.
      return [];

    case 'mcu':
    case 'breadboard':
    case 'display':
    case 'i2c-sensor':
    case 'lcd':
    case 'servo':
      /*
       * These contribute topology only. Their pins become sources, or receive
       * bus traffic, when the engine drives them -- which depends on firmware
       * state and so cannot be frozen into a static netlist.
       */
      return [];
  }
}
/**
 * A component whose two pins landed on the same net would stamp a resistor
 * from a node to itself. That is not a modelling nicety -- it makes the matrix
 * singular -- so it is dropped here and the caller reports it as a short.
 */
function isDegenerate(element: Element): boolean {
  return element.kind !== 'ground' && element.a === element.b;
}

export function buildNetlist(
  bench: Bench,
  state: DynamicState,
  relayEnergized: ReadonlyMap<string, boolean> = new Map(),
): Netlist {
  const sets = new DisjointSet(bench.terminals.length);

  // Internal part connections: breadboard strips and rails, MCU ground planes.
  for (const part of bench.parts) {
    const byNet = new Map<string, number[]>();
    for (const pin of part.definition.pins) {
      if (!pin.net) continue;
      const members = byNet.get(pin.net) ?? [];
      members.push(part.terminals[pin.id]);
      byNet.set(pin.net, members);
    }
    for (const members of byNet.values()) {
      for (let i = 1; i < members.length; i++) sets.union(members[0], members[i]);
    }
  }

  for (const wire of bench.wires) sets.union(wire.from, wire.to);

  // Two leads sharing a hole, with no jumper and no internal net to say so.
  unionCoincidentContacts(bench, sets);

  const groundRoot = chooseGroundRoot(bench, sets);

  // Number the nets, skipping the reference.
  const nodeIndexOfRoot = new Map<number, number>();
  const netsByRoot = new Map<number, number[]>();
  let nodeCount = 0;
  for (const terminal of bench.terminals) {
    const root = sets.find(terminal.id);
    if (root === groundRoot) continue;
    if (!nodeIndexOfRoot.has(root)) {
      nodeIndexOfRoot.set(root, nodeCount);
      netsByRoot.set(root, []);
      nodeCount++;
    }
    netsByRoot.get(root)!.push(terminal.id);
  }

  const nodeOfTerminal = new Int32Array(bench.terminals.length).fill(GROUND);
  const nets: NetInfo[] = [];
  for (const [root, terminals] of netsByRoot) {
    const index = nodeIndexOfRoot.get(root)!;
    for (const terminal of terminals) nodeOfTerminal[terminal] = index;
    nets.push({ index, terminals });
  }

  const pinNode = new Map<string, number>();
  for (const part of bench.parts) {
    for (const pinId of Object.keys(part.terminals)) {
      const terminal = part.terminals[pinId];
      pinNode.set(`${part.id}:${pinId}`, nodeOfTerminal[terminal]);
    }
  }

  const elements: Element[] = [];
  for (const part of bench.parts) {
    for (const element of elementsForPart(part, pinNode, state, relayEnergized)) {
      if (!isDegenerate(element)) elements.push(element);
    }
  }
  for (const wire of bench.wires) {
    const a = nodeOfTerminal[wire.from];
    const b = nodeOfTerminal[wire.to];
    if (a === b) continue;
    elements.push({
      kind: 'resistor',
      a,
      b,
      ohms: wireResistanceOhms(wire.gaugeAwg, wire.lengthMm),
      label: `wire ${wire.id}`,
    });
  }

  return { nodeOfTerminal, nodeCount, nets, elements, pinNode };
}
