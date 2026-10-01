/**
 * The simulation engine: pins in, solved voltages out.
 *
 * Every timestep rebuilds the element list as the bench's passive netlist plus
 * whatever the firmware's pins and the board's own supply currently demand,
 * then solves it. Pin outputs are modelled as a source behind the pin's real
 * output impedance rather than an ideal source, which is what makes a shorted
 * pin draw the current it really would instead of an infinite one.
 *
 * PWM is switched, not averaged: each solve sees the instantaneous level for
 * that instant in the period. Brightness then falls out of the solver over
 * successive steps, the way it does on real hardware, instead of being faked by
 * handing the LED an averaged voltage.
 */

import { solveCircuit, type Solution } from './circuit';
import { GROUND, type Element } from './elements';
import { buildNetlist, type Netlist } from './netlist';
import type { Bench, PartInstance } from './bench';
import { NO_DYNAMIC_STATE, type DynamicState } from './catalog';
import {
  INTERNAL_PULLUP_OHMS,
  INPUT_IMPEDANCE_OHMS,
  McuRuntime,
  floatingInputFraction,
} from './mcu';

export interface EngineOptions {
  bench: Bench;
  mcu: McuRuntime;
  dynamicState?: DynamicState;
}

/**
 * Silkscreen name of each board's regulated supply rail.
 *
 * A board is powered by its own regulator, not by whatever the user wired to
 * it, so the rail gets a source here. Without it a breadboard with nothing
 * connected to 3V3 would read 0 V there, which is not what happens on a real
 * board and hides every divider that references the rail.
 */
const SUPPLY_RAIL_LABELS: Readonly<Record<string, string>> = {
  esp32: '3V3',
  uno: '5V',
};

export class Engine {
  readonly mcu: McuRuntime;

  /** Simulated time in milliseconds. */
  timeMs = 0;

  private bench: Bench;
  private dynamicState: DynamicState;
  private netlist: Netlist | null = null;
  private solution: Solution | null = null;
  private previousVoltages: Float64Array | null = null;
  private mcuPart: PartInstance | null = null;
  /** Pin id to the index of the voltage source driving it in the last solve. */
  private pinSourceIndex = new Map<string, number>();
  /** Net index of the board's regulated supply rail. */
  private supplyNet: number = GROUND;

  constructor(options: EngineOptions) {
    this.bench = options.bench;
    this.mcu = options.mcu;
    this.dynamicState = options.dynamicState ?? NO_DYNAMIC_STATE;
  }

  /**
   * Rebuilds the topology. Call after moving a part or rerouting a wire; the
   * netlist is derived from geometry, so a stale one silently reads the wrong
   * voltages rather than failing.
   */
  rebuild(bench?: Bench, dynamicState?: DynamicState): void {
    if (bench) this.bench = bench;
    if (dynamicState) this.dynamicState = dynamicState;

    this.mcuPart =
      this.bench.parts.find((part) => part.definition.component.kind === 'mcu') ?? null;
    this.netlist = buildNetlist(this.bench, this.dynamicState);
    this.solution = null;
    this.previousVoltages = null;
    this.pinSourceIndex.clear();
    this.supplyNet = GROUND;

    if (this.mcuPart) {
      const railLabel = SUPPLY_RAIL_LABELS[this.mcu.board.id];
      const railPin = this.mcu
        .pins()
        .find((pin) => pin.role === 'power' && pin.label === railLabel);
      if (railPin) {
        this.supplyNet =
          this.netlist.pinNode.get(`${this.mcuPart.id}:${railPin.id}`) ?? GROUND;
      }
    }
  }

  get currentNetlist(): Netlist {
    if (!this.netlist) this.rebuild();
    return this.netlist!;
  }

  /** Latest solved state, or null before the first step. */
  get currentSolution(): Solution | null {
    return this.solution;
  }

  /** Net index of the board's own supply rail. */
  get supplyRailNet(): number {
    return this.supplyNet;
  }

  /** Net index a terminal belongs to, or `GROUND` (-1). */
  netOfTerminal(terminal: number): number {
    return this.currentNetlist.nodeOfTerminal[terminal];
  }

  netOfMcuPin(pinId: string): number {
    if (!this.mcuPart) return GROUND;
    return this.currentNetlist.pinNode.get(`${this.mcuPart.id}:${pinId}`) ?? GROUND;
  }

  /** Solved voltage of a net, in volts. Undriven nets read 0. */
  voltageOfNet(net: number): number {
    if (net === GROUND || !this.solution) return 0;
    return this.solution.voltages[net] ?? 0;
  }

  /**
   * Whether the circuit has anything that changes with time on its own.
   *
   * A board holding steady levels with no PWM running and no capacitors in the
   * netlist reaches the same solution immediately. Re-solving it a thousand
   * times to advance a one-second `delay` produces identical answers at real
   * cost, which is the difference between a smooth bench and a stalled one.
   */
  hasDynamics(): boolean {
    for (const pin of this.mcu.pins()) {
      if (this.mcu.configurationOf(pin.id).pwm) return true;
    }
    return this.currentNetlist.elements.some((element) => element.kind === 'capacitor');
  }

  /**
   * Moves simulated time forward without solving.
   *
   * Only valid while `hasDynamics()` is false, where no node voltage can have
   * changed over the skipped interval.
   */
  skip(dtSeconds: number): void {
    this.timeMs += dtSeconds * 1000;
  }

  /**
   * Current flowing out of a pin into the circuit, in amps.
   *
   * Taken from the branch current of the source that drives the pin, which is
   * positive into the pin: a pin sourcing current reads positive, one sinking
   * (an LED pulling it down) reads negative.
   */
  pinCurrentAmps(pinId: string): number {
    const index = this.pinSourceIndex.get(pinId);
    if (index === undefined || !this.solution) return 0;
    return this.solution.sourceCurrents[index] ?? 0;
  }

  /**
   * Advances the simulation by `dtSeconds`, re-solving at the end of the step.
   *
   * Time is taken first so pins are evaluated at the instant they will be read
   * from; PWM phase at the end of a step is what the following reads should see.
   */
  step(dtSeconds: number): Solution {
    this.timeMs += dtSeconds * 1000;
    return this.solveAt(this.timeMs, dtSeconds);
  }

  /** Solves the circuit as it stands right now, without advancing time. */
  settle(): Solution {
    return this.solveAt(this.timeMs, 1e-5);
  }

  /** Reads a pin as a boolean, using the midpoint of the supply as the threshold. */
  readDigital(gpio: number): boolean {
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (!pinId) return false;
    return this.readPinDigital(pinId);
  }

  readPinDigital(pinId: string): boolean {
    return this.voltageOfNet(this.netOfMcuPin(pinId)) >= this.mcu.board.logicVolts / 2;
  }

  /** Reads a pin as an integer across the board's ADC range. */
  readAnalog(gpio: number): number {
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (!pinId) return 0;
    const volts = this.voltageOfNet(this.netOfMcuPin(pinId));
    const fullScale = this.mcu.board.adcBits === 12 ? 4095 : 1023;
    const clamped = Math.min(this.mcu.board.logicVolts, Math.max(0, volts));
    return Math.round((clamped / this.mcu.board.logicVolts) * fullScale);
  }

  /**
   * Whether an input pin has nothing establishing its level.
   *
   * Reachable means the net ties to ground through passives, or to a net that
   * something drives. A pin reaching neither is genuinely floating and its
   * reading is noise, which is the whole point of teaching pull-ups.
   */
  isFloating(pinId: string): boolean {
    const net = this.netOfMcuPin(pinId);
    if (net === GROUND) return false;
    return !this.reachableFromGroundOrSource().has(net);
  }

  private solveAt(timeMs: number, dtSeconds: number): Solution {
    const netlist = this.currentNetlist;
    const { elements, nodeCount } = this.buildElements(netlist, timeMs);

    const solution = solveCircuit(elements, {
      nodeCount,
      dtSeconds,
      previousVoltages: this.previousVoltages,
    });

    this.solution = solution;
    // Capacitor history only cares about real nets, so trim the internal rows.
    this.previousVoltages = solution.voltages.slice(0, netlist.nodeCount);
    return solution;
  }

  /**
   * Assembles the netlist, the board's supply, and one Thevenin source per
   * active pin.
   *
   * Each pin gets an internal node so its output impedance can sit between the
   * pin and its ideal source. That extra node is why `nodeCount` here exceeds
   * the netlist's: the surplus rows are private to this solve and are not part
   * of any net a probe can see.
   *
   * Pins whose net *is* ground are deliberately kept. A jumper from a pin to
   * ground is exactly the fault worth modelling, and dropping the source would
   * silently model a short as a dead pin.
   */
  private buildElements(
    netlist: Netlist,
    timeMs: number,
  ): { elements: Element[]; nodeCount: number } {
    const elements: Element[] = [...netlist.elements];
    let internalNet = netlist.nodeCount;
    let sourceOrdinal = 0;
    this.pinSourceIndex.clear();

    if (this.supplyNet !== GROUND) {
      elements.push({
        kind: 'voltageSource',
        a: this.supplyNet,
        b: GROUND,
        volts: this.mcu.board.logicVolts,
        label: 'board supply',
      });
      sourceOrdinal++;
    }

    if (!this.mcuPart) return { elements, nodeCount: internalNet };

    const active = this.mcu
      .pins()
      .filter((pin) => pin.role === 'gpio' || pin.role === 'adc' || pin.role === 'dac')
      .map((pin) => ({
        pin,
        net: netlist.pinNode.get(`${this.mcuPart!.id}:${pin.id}`) ?? GROUND,
        configuration: this.mcu.configurationOf(pin.id),
      }));

    for (const { pin, net, configuration } of active) {
      if (configuration.direction === 'output') {
        const level = this.mcu.levelOf(pin.id, timeMs) * this.mcu.board.logicVolts;
        this.pinSourceIndex.set(pin.id, sourceOrdinal++);
        elements.push({ kind: 'voltageSource', a: internalNet, b: GROUND, volts: level });
        elements.push({
          kind: 'resistor',
          a: net,
          b: internalNet,
          // Sourcing and sinking are not symmetric on any real part.
          ohms:
            level > this.mcu.board.logicVolts / 2
              ? this.mcu.board.sourceOhms
              : this.mcu.board.sinkOhms,
        });
        internalNet++;
        continue;
      }

      this.pinSourceIndex.set(pin.id, sourceOrdinal++);

      if (configuration.direction === 'inputPullUp') {
        elements.push({
          kind: 'voltageSource',
          a: internalNet,
          b: GROUND,
          volts: this.mcu.board.logicVolts,
        });
        elements.push({
          kind: 'resistor',
          a: net,
          b: internalNet,
          ohms: INTERNAL_PULLUP_OHMS,
        });
        internalNet++;
        continue;
      }

      // A plain input: just its own leakage impedance, plus whatever drift the
      // parasitic charges settle to. Any external pull-down outranks this.
      elements.push({
        kind: 'voltageSource',
        a: internalNet,
        b: GROUND,
        volts: floatingInputFraction(timeMs) * this.mcu.board.logicVolts,
      });
      elements.push({
        kind: 'resistor',
        a: net,
        b: internalNet,
        ohms: INPUT_IMPEDANCE_OHMS,
      });
      internalNet++;
    }

    return { elements, nodeCount: internalNet };
  }

  /**
   * Nets that have a defined level: tied to ground through passives, or tied to
   * a net something drives. Walks the passive graph rather than inspecting each
   * element, because the path to a supply can be arbitrarily long.
   */
  private reachableFromGroundOrSource(): Set<number> {
    const netlist = this.currentNetlist;
    const adjacency = new Map<number, number[]>();

    const link = (a: number, b: number) => {
      if (a === b) return;
      const existing = adjacency.get(a);
      if (existing) existing.push(b);
      else adjacency.set(a, [b]);
    };

    const driven = new Set<number>();
    if (this.supplyNet !== GROUND) driven.add(this.supplyNet);

    for (const element of netlist.elements) {
      if (element.kind === 'voltageSource' || element.kind === 'currentSource') {
        if (element.a !== GROUND) driven.add(element.a);
        if (element.b !== GROUND) driven.add(element.b);
        continue;
      }
      if (element.kind === 'ground') continue;
      link(element.a, element.b);
    }

    if (this.mcuPart) {
      for (const pin of this.mcu.pins()) {
        const configuration = this.mcu.configurationOf(pin.id);
        if (configuration.direction !== 'output') continue;
        const net = netlist.pinNode.get(`${this.mcuPart.id}:${pin.id}`);
        if (net !== undefined && net !== GROUND) driven.add(net);
      }
    }

    const reached = new Set<number>();
    const queue: number[] = [];
    for (const net of driven) {
      if (reached.has(net)) continue;
      reached.add(net);
      queue.push(net);
    }
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const neighbour of adjacency.get(current) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        queue.push(neighbour);
      }
    }
    return reached;
  }
}