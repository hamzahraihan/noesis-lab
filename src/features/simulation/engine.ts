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
import { createController, type DisplayController } from '@/features/parts';
import { createI2cDevice, isI2cDevice, type I2cDevice } from '@/features/parts';
import { coilEnergized } from '@/features/parts';
import { IR_RELEASE_MS, NEC_CODES, REMOTE_KEY_KNOB } from '@/features/parts';
import { DIGIT_KNOB } from '@/features/parts';
import { SD_CARD_BYTES } from '@/features/parts';
import { clampChannel, pixelCount, type PixelColor } from '@/features/parts';
import {
  STEP_DEGREES,
  stepTransition,
  windingPolarity,
  type WindingPolarity,
} from '@/features/parts';
import { Servo } from '@/features/parts';
import { createLcd, type Lcd1602 } from '@/features/parts';
import { Ds1307 } from '@/features/parts';
import { Ili9341 } from '@/features/parts';
import { Ssd1306 } from '@/features/parts';
import { SevenSegment } from '@/features/parts';

import { solveCircuit, type Solution } from './circuit';
import { ProbeDeck } from './probe';
import type { Multimeter } from './multimeter';
import { GROUND, type Element } from './elements';
import { buildNetlist, type Netlist } from './netlist';
import type { Bench, PartInstance } from './bench';
import { NO_DYNAMIC_STATE, type DynamicState } from '@/features/parts';
import type { ScriptedI2c } from './scripted/i2c';
import { SCRIPTED_SAMPLE_MS, type ScriptedSampler } from './scripted/sampler';
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
  rp2040: '3V3',
  pico: '3V3',
  'raspberry-pi-4': '3V3',
  uno: '5V',
  mega: '5V',
  nano: '5V',
  franzininho: '5V',
};

/**
 * What the real-time clocks read when simulated time is zero.
 *
 * Midnight, 1 January 2000: the power-up story the DS1307 model itself tells.
 * Clocks advance from here as `timeMs` moves; tests assert advancement, not
 * the wall-clock alignment, which is local-time by construction.
 */
const RTC_EPOCH_MS = new Date(2000, 0, 1).getTime();

/**
 * Stock Arduino Servo pulse window: `write(angle)` maps 0–180° onto these
 * microsecond bounds. Trade-off: hand-rolled generic 1000–2000 µs pulses read compressed (≈44–141°); Arduino-library timing is exact because that is what this bench executes.
 */
const SERVO_MIN_US = 544;
const SERVO_MAX_US = 2400;

export class Engine {
  readonly mcu: McuRuntime;

  /** Simulated time in milliseconds. */
  timeMs = 0;

  private bench: Bench;
  private dynamicState: DynamicState;
  private netlist: Netlist | null = null;
  private solution: Solution | null = null;
  /**
   * Per-gpio last answer for `readDigital`, keyed on the solved state.
   *
   * The Timer1 capture sampler reads a pin on every executed instruction, and
   * between solves the answer cannot change — a solution and a netlist are
   * both replaced, never mutated, so identity comparison is exact. This
   * collapses that per-instruction traffic to a map hit plus two identity
   * checks instead of a net lookup plus a voltage walk.
   */
  private readonly digitalReadMemo = new Map<
    number,
    { solution: Solution | null; netlist: Netlist | null; value: boolean }
  >();
  private previousVoltages: Float64Array | null = null;
  private mcuPart: PartInstance | null = null;
  /** Pin id to the index of the voltage source driving it in the last solve. */
  private pinSourceIndex = new Map<string, number>();
  /** Net index of the board's regulated supply rail. */
  private supplyNet: number = GROUND;
  /**
   * Solve cache key: a re-solve with the same simulated instant, timestep,
   * pin intents, topology and stamped extras answers identically (the solver
   * is deterministic), so repeated reads between writes reuse it.
   *
   * This is what makes three button reads in one loop cost one solve instead
   * of three: only the first observes new pin levels, the rest re-read the
   * same answer. Time must be part of the key — floating inputs drift with
   * it — as must the timestep, whose capacitor companion differs per dt.
   */
  private solvedAtMs = NaN;
  private solvedDt = NaN;
  private solvedMcuRev = -1;
  private solvedTopoRev = -1;
  private solvedElemRev = -1;
  /**
   * Held-remote control state at the last solve.
   *
   * The IR pump reads the operator's knobs straight from control state, which
   * no revision counter sees: turning the key knob mid-hold must re-solve
   * (part of the key), while presses rebuild and null the cache anyway.
   */
  private solvedIrKey = '';
  /**
   * The last reading every scripted part gave, and who asks them.
   *
   * Sampling is the backend's job (`scripted/sampler.ts`): the engine only knows
   * that some parts answer through a function, and how often to ask.
   */
  private scriptedValues: ReadonlyMap<string, number> = new Map();
  private scriptedSampler: ScriptedSampler | null = null;
  private scriptedI2c: ScriptedI2c | null = null;
  private scriptedSampledAtMs = Number.NEGATIVE_INFINITY;
  /** Topology generations: bumped on every netlist (re)assignment. */
  private topoRevision = 0;
  /**
   * Stamped-extra generations: the meter and servo loads are stamped around
   * the netlist rather than into it, so their changes bump this instead.
   */
  private elemRevision = 0;

  constructor(options: EngineOptions) {
    this.bench = options.bench;
    this.mcu = options.mcu;
    this.dynamicState = options.dynamicState ?? NO_DYNAMIC_STATE;
  }

  /**
   * Probes currently clipped onto a net.
   *
   * Capture reads the solved voltages rather than anything a bus model reports,
   * so a scope cannot show a cleaner signal than the circuit actually produced.
   */

  /**
   * Multimeter clipped across the bench, or null when it is away.
   *
   * The meter is stamped into the netlist rather than merely reading from it,
   * because in amps and ohms mode it *is* part of the circuit: an ammeter in
   * series is a shunt, and an ohmmeter is a test current source.
   */
  readonly probes = new ProbeDeck();

  private meter: Multimeter | null = null;

  /** Clips the meter onto two nets, or lifts it with null. */
  setMeter(meter: Multimeter | null): void {
    this.meter = meter;
    // The meter stamps into the netlist in amps and ohms mode: same nets,
    // different circuit.
    this.elemRevision++;
  }

  /**
   * Marks stamped extras dirty without changing any net.
   *
   * Called after mutations the netlist cannot see but `buildElements` stamps
   * around it — a servo changing load on write — so the next solve rebuilds
   * rather than reusing a cache from before the change.
   */
  touch(): void {
    this.elemRevision++;
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
    // Drop armature state for parts that are gone; a later part reusing an
    // id must start resting, never energized.
    for (const partId of [...this.relayEnergized.keys()]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.relayEnergized.delete(partId);
      }
    }
    // Drop seeded flags the same way, so a re-placed part takes a fresh seed.
    for (const partId of [...this.seededRtcParts]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.seededRtcParts.delete(partId);
      }
    }
    for (const partId of [...this.sonarMeasuring.keys()]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.sonarMeasuring.delete(partId);
      }
    }
    for (const partId of [...this.stepperState.keys()]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.stepperState.delete(partId);
      }
    }
    for (const partId of [...this.pixelBuffers.keys()]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.pixelBuffers.delete(partId);
      }
    }
    for (const partId of [...this.dialedDigits.keys()]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.dialedDigits.delete(partId);
      }
    }
    for (const partId of [...this.sdFiles.keys()]) {
      if (!this.bench.parts.some((part) => part.id === partId)) {
        this.sdFiles.delete(partId);
      }
    }
    // A rebuild restarts the world the transmission clock runs against
    // (notably a firmware reload zeroes time), so a stranded window must
    // go: a still-pressed remote re-arms on the next solve anyway.
    this.irTransmitting = null;
    this.netlist = buildNetlist(
      this.bench,
      this.dynamicState,
      this.relayEnergized,
      this.sonarMeasuring,
      this.irTransmitting !== null,
      this.scriptedValues,
    );
    this.topoRevision++;
    this.solution = null;
    this.previousVoltages = null;
    this.pinSourceIndex.clear();
    // Fresh wiring is fresh signal history: stale edges would pair a rise from
    // the old bench with a fall from the new one into a bogus width.
    this.gpioEdges.clear();
    this.servoPendingRise.clear();
    this.supplyNet = GROUND;

    if (this.mcuPart) {
      const railLabel = SUPPLY_RAIL_LABELS[this.mcu.board.id];
      const railPin = this.mcu
        .pins()
        .find((pin) => pin.role === 'power' && pin.label === railLabel);
      if (railPin) {
        this.supplyNet = this.netlist.pinNode.get(`${this.mcuPart.id}:${railPin.id}`) ?? GROUND;
      }
    }
    this.rebuildBus();
  }

  /** Display parts on the bench, keyed by part id, for the renderer to read. */
  private readonly displays = new Map<string, DisplayController>();

  /** Everything on the bench that answers to an I2C address. */
  private readonly devices = new Map<string, I2cDevice>();

  /** Servo parts, keyed by part id, for the renderer and the firmware port. */
  private readonly servos = new Map<string, Servo>();

  /**
   * Cycle-stamped GPIO transitions per gpio, reported by the AVR bridge.
   *
   * Entries carry the driven level at report time (the bridge reports after
   * writing it), so the pump can pair rises with falls. Bounded at the latest
   * 64 per gpio, oldest dropped; drained by `pumpServoPulse` every solve.
   */
  private readonly gpioEdges = new Map<number, Array<{ cycles: number; high: boolean }>>();

  /**
   * Unmatched rise per gpio, carried across drains.
   *
   * A 1–2 ms servo pulse straddles the 1–4 ms settle cadence, so the rise and
   * the fall routinely land in different solve windows; keeping the pending
   * rise is what lets the later window still complete the width.
   */
  private readonly servoPendingRise = new Map<number, number>();

  /**
   * Relay armature state, keyed by part id.
   *
   * Updated from the solved coil volts after each solve, with the solve
   * repeated once on change -- the armature moves within the same tick.
   * Pruned on rebuild so a removed relay leaves no stale entry behind.
   */
  private readonly relayEnergized = new Map<string, boolean>();
  /** Part ids whose RTC preset has been applied (applied once, never again). */
  private readonly seededRtcParts = new Set<string>();

  /**
   * Live IR transmission, if any remote is being held.
   *
   * Set while a remote is pressed and held briefly past release for the
   * decode window. One transmission at a time: lowest bench order wins,
   * never a mix.
   */
  private irTransmitting: { code: number; untilMs: number } | null = null;

  /**
   * Last dialed digit per dialer part.
   *
   * Latched while the dial control is held and kept after release, the
   * way a real dial leaves its number behind; pruned with everything
   * else on rebuild. Absent means never dialed, which reads as -1.
   */
  private readonly dialedDigits = new Map<string, number>();

  /**
   * Named text files per card part: the card's whole filesystem.
   *
   * Created lazily on first write and pruned only when the part leaves
   * the bench -- files survive rebuilds and firmware reloads the way a
   * real card keeps bytes without power. Names are verbatim keys in one
   * flat namespace; separators have no meaning.
   */
  private readonly sdFiles = new Map<string, Map<string, string>>();

  /** Stepper shaft state: previous winding polarities plus angle, per axis. */
  private readonly stepperState = new Map<
    string,
    Array<{ prevA: WindingPolarity; prevB: WindingPolarity; angle: number }>
  >();

  /**
   * Addressable LED buffers, keyed by part id.
   *
   * Fresh arrays on every bus rebuild, like the servo models: colors are
   * display state the sketch rewrites, not circuit state the solver reads,
   * so nothing here is stamped into any netlist.
   */
  private readonly pixelBuffers = new Map<string, PixelColor[]>();

  /**
   * Sonar parts with an echo measurement running, keyed by part id.
   *
   * Written by the `pulseIn` service around the wait it reports (not
   * derived from volts like the relay map), so the ECHO line is high only
   * while a measurement runs. Changed through `setSonarMeasuring`, which
   * rebuilds the netlist when the flag moves.
   */
  private readonly sonarMeasuring = new Map<string, boolean>();

  /** Character LCD parts, keyed by part id. */
  private readonly lcds = new Map<string, Lcd1602>();

  /** Last level seen on each LCD's enable line, to spot its rising edge. */
  private readonly lcdStrobe = new Map<string, boolean>();

  /** Nets the firmware's I2C pins are driving. */
  private i2cNets = new Set<number>();

  /** Nets the firmware's SPI pins are driving. */
  private spiNets = new Set<number>();

  /**
   * Finds the parts that are on a bus at all, and works out which bus.
   *
   * Each bus exists wherever the firmware's own pins sit, so a device reaches
   * one only by being wired there. That is why an unwired screen stays dark and
   * an unwired sensor reads nothing, instead of both mysteriously working.
   */
  private rebuildBus(): void {
    /*
     * Whatever was already on the bench keeps its controller.
     *
     * A controller's framebuffer is what the firmware has drawn so far, and a
     * rebuild is a re-solve of the circuit, not a reset of the hardware. Making
     * new ones here -- which this did, on every rebuild -- meant the renderer
     * kept a reference to one panel while the bus wrote its bytes into another,
     * and the screen stayed black on a bench that was wired correctly.
     */
    const previousDisplays = new Map(this.displays);
    const previousDevices = new Map(this.devices);
    /*
     * Character panels carry too, for the same reason: their DDRAM is what the
     * sketch has written and a re-solve must not blank the glass. They are not
     * in `displays` because the library drives them through their own port, so
     * they need their own carried map.
     */
    const previousLcds = new Map(this.lcds);
    this.displays.clear();
    this.devices.clear();
    this.servos.clear();
    this.lcds.clear();
    this.lcdStrobe.clear();
    this.i2cNets.clear();
    this.spiNets.clear();
    const netlist = this.currentNetlist;
    const mcuPart = this.mcuPart;

    for (const part of this.bench.parts) {
      const carried = previousDisplays.get(part.id);
      let controller: DisplayController | undefined = carried ?? undefined;
      if (!controller) {
        // The multiplexed 7-segment display keeps its own per-digit latch so
        // the renderer never depends on sampling a transient digit strobe.
        if (part.definition.component.kind === '7segment') {
          controller = new SevenSegment(part.definition.component.digits ?? 1);
        } else {
          controller = createController(part.definition) ?? undefined;
        }
      }
      if (controller) this.displays.set(part.id, controller);
      /*
       * A display that speaks I2C is one model, not two. Registering a second
       * copy here would let the bus write into a framebuffer the renderer
       * never reads, and the panel would sit dark on a bench wired correctly.
       *
       * Whatever was already on the bench keeps its device, the way displays
       * keep their controllers above: a rebuild is a re-solve of the circuit,
       * not a reset of the hardware. Recreating devices here wiped sketch
       * NVRAM writes (disarming the alarm on every button release) and would
       * re-apply part presets over live adjustments. A part's preset applies
       * once, on the first rebuild after it appears — regardless of whether
       * the device itself was created before or after the assignment — and
       * never again for that part id.
       */
      let device: I2cDevice | null | undefined =
        controller && isI2cDevice(controller) ? controller : previousDevices.get(part.id);
      if (!device) {
        /*
         * A scripted slave is built with two closures rather than a reference to
         * the host: the part keeps its device across rebuilds (its register
         * pointer is state, like a display's frame), while the runtime that
         * answers it is installed -- or replaced -- whenever the backend says.
         */
        device = createI2cDevice(part.definition, {
          read: (register, count) =>
            this.scriptedI2c?.read(part.id, register, count, this.timeMs, this.dynamicState) ??
            null,
          write: (register, bytes) =>
            this.scriptedI2c?.write(part.id, register, bytes, this.timeMs, this.dynamicState) ??
            false,
        });
      }
      if (device instanceof Ds1307 && part.initialRtc && !this.seededRtcParts.has(part.id)) {
        const seed = part.initialRtc;
        device.applyPreset(seed.hours, seed.minutes, seed.seconds, seed.nvram ?? []);
        this.seededRtcParts.add(part.id);
      }
      if (device) this.devices.set(part.id, device);
      if (part.definition.component.kind === 'servo') this.servos.set(part.id, new Servo());
      const lcd = previousLcds.get(part.id) ?? createLcd(part.definition);
      if (lcd) this.lcds.set(part.id, lcd);
      if (
        part.definition.component.kind === 'neopixel' ||
        part.definition.component.kind === 'neopixel-matrix' ||
        part.definition.component.kind === 'led-ring'
      ) {
        const count = pixelCount(part.definition);
        this.pixelBuffers.set(
          part.id,
          Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0 })),
        );
      }
    }

    if (!mcuPart) return;
    for (const gpio of this.mcu.i2cPins) {
      const net = this.netOfBoardGpio(netlist, mcuPart.id, gpio);
      if (net !== null) this.i2cNets.add(net);
    }
    for (const gpio of this.mcu.spiPins) {
      const net = this.netOfBoardGpio(netlist, mcuPart.id, gpio);
      if (net !== null) this.spiNets.add(net);
    }

    for (const partId of this.devices.keys()) {
      this.devices.get(partId)!.onBus = this.isOnI2cBus(partId);
    }
  }

  /**
   * Feeds the character LCDs whatever their pins are actually saying.
   *
   * An HD44780 has no bus: a byte arrives as the enable line strobed high,
   * with RS saying data or command and D4-D7 carrying the nibble. Decoding it
   * from the pins rather than from the call that asked for it is what makes an
   * LCD wired to the wrong pins stay blank instead of working anyway.
   */
  private pumpLcds(): void {
    for (const [partId, lcd] of this.lcds) {
      const nets = this.lcdNets(partId);
      if (!nets) continue;
      const high = this.mcu.board.logicVolts / 2;
      /*
       * One nibble per rising edge, and only on a rising edge. Enable idles
       * high between strobes, so latching on every solve that observes it
       * high re-latches the stale nibble — and every solve that re-latches
       * shifts the panel's pairing by one, garbling everything after it. The
       * flag arms on a low solve and is consumed by the high one; hosts that
       * strobe via pins may also arm via `primeLcdEdges` to skip the low solve.
       */
      const strobe = this.voltageOfNet(nets.enable) >= high;
      if (!strobe) {
        this.lcdStrobe.set(partId, true);
        continue;
      }
      if (!this.lcdStrobe.get(partId)) continue;
      this.lcdStrobe.set(partId, false);

      /*
       * D4 is the panel's *most* significant bit. A four-bit HD44780 takes its
       * command and data a nibble at a time, high nibble first, so D4 carries
       * bit 4 and D7 carries bit 1 -- which is the opposite of the order a
       * reader expects and the reason a first implementation sends zeros.
       */
      /*
       * The five data lines carry a nibble, highest bit on D4, and the panel
       * shifts the two halves together itself -- which is what an HD44780 does,
       * and why it needs five data pins where eight would do the same job.
       */
      const value =
        (this.voltageOfNet(nets.d4) ? 0b10000 : 0) |
        (this.voltageOfNet(nets.d5) ? 0b01000 : 0) |
        (this.voltageOfNet(nets.d6) ? 0b00100 : 0) |
        (this.voltageOfNet(nets.d7) ? 0b00010 : 0) |
        (this.voltageOfNet(nets.d0) ? 0b00001 : 0) |
        0;
      lcd.receive(this.voltageOfNet(nets.rs) >= high, value);
    }
  }

  /**
   * Latches each multiplexed digit's pattern while its common is asserted.
   *
   * Render instants can never observe a multiplexed strobe reliably, so the
   * latch lives here — fed every solve — and the renderer reads the held
   * frame. Single-digit parts use COM.1; multi-digit parts use DIG1..DIGn.
   * The 4-digit glass also carries a colon on COM/CLN, which follows the
   * live levels rather than latching.
   *
   * Levels come from the firmware's own pin states (Wokwi-style digital
   * drive), not the solved analog volts: the Thevenin source impedance sags
   * a loaded digit common to ~2.8V and lit segments up to ~0.7V, which is
   * correct for the scope but leaves the latch living on threshold margins.
   * A net no firmware output drives falls back to the solved volts, so an
   * unwired or miswired display still reads dark/wrong instead of working.
   *
   * Simulated time rides along so segment-multiplexed firmware (one segment
   * per solve across every digit needing it) accumulates into a stable frame
   * instead of flickering through single-segment slices: slices persist for
   * SEGMENT_PERSIST_MS while full digit patterns overwrite immediately.
   */
  private pumpSevenSegments(): void {
    for (const [partId, controller] of this.displays) {
      if (!(controller instanceof SevenSegment)) continue;
      const nets = this.sevenSegmentNets(partId, controller.digitCount);
      if (!nets) continue;
      // A floating segment cannot sink current, so it reads dark (HIGH on a
      // common-anode glass); a floating digit common selects nothing (LOW).
      // Only nets wired to more than their own pin fall back to solved volts,
      // which is what keeps a segment strapped to GND lit and one to 5V dark.
      const terminalCount = (net: number): number =>
        this.currentNetlist.nets.find((entry) => entry.index === net)?.terminals.length ?? 0;
      const high = this.mcu.board.logicVolts;
      const segmentLevel = (net: number): number =>
        this.mcuOutputLevelOfNet(net) ?? (terminalCount(net) <= 1 ? high : this.voltageOfNet(net));
      const digitLevel = (net: number): number =>
        this.mcuOutputLevelOfNet(net) ?? (terminalCount(net) <= 1 ? 0 : this.voltageOfNet(net));
      const com =
        nets.colon !== null
          ? (this.mcuOutputLevelOfNet(nets.colon.com) ??
            (terminalCount(nets.colon.com) <= 1 ? 0 : this.voltageOfNet(nets.colon.com)))
          : undefined;
      const cln =
        nets.colon !== null
          ? (this.mcuOutputLevelOfNet(nets.colon.cln) ??
            (terminalCount(nets.colon.cln) <= 1 ? high : this.voltageOfNet(nets.colon.cln)))
          : undefined;
      controller.update(
        nets.digits.map((net) => digitLevel(net)),
        nets.segments.map((net) => segmentLevel(net)),
        com,
        cln,
        this.timeMs,
      );
    }
  }

  /**
   * Ideal firmware level driving a net, or null when none does.
   *
   * The same `levelOf` the solver stamps behind the output impedance, minus
   * the sag — exactly what a digital peripheral like Wokwi's 7-segment
   * element reads. Inputs, pull-ups and floating nets are not firmware
   * outputs and correctly report null here.
   */
  private mcuOutputLevelOfNet(net: number): number | null {
    if (net === GROUND || !this.mcuPart) return null;
    const netlist = this.currentNetlist;
    for (const pin of this.mcu.pins()) {
      if (this.mcu.configurationOf(pin.id).direction !== 'output') continue;
      if ((netlist.pinNode.get(`${this.mcuPart.id}:${pin.id}`) ?? GROUND) !== net) continue;
      return this.mcu.levelOf(pin.id, this.timeMs) * this.mcu.board.logicVolts;
    }
    return null;
  }

  /** A 7-segment display's signal nets, or null when not wired. */
  private sevenSegmentNets(
    partId: string,
    digitCount: number,
  ): { segments: number[]; digits: number[]; colon: { com: number; cln: number } | null } | null {
    const netlist = this.currentNetlist;
    const net = (pin: string): number => {
      const found = netlist.pinNode.get(`${partId}:${pin}`);
      return found === undefined ? GROUND : found;
    };
    const hasPin = (pin: string): boolean => netlist.pinNode.has(`${partId}:${pin}`);

    const segments = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map(net);
    const digitPins =
      digitCount > 1
        ? Array.from({ length: digitCount }, (_, index) => `DIG${index + 1}`)
        : ['COM.1'];
    const digits = digitPins.map(net);

    // Require at least one segment and one digit to be wired.
    const hasSeg = segments.some((n) => n !== GROUND);
    const hasDig = digits.some((n) => n !== GROUND);
    if (!hasSeg || !hasDig) return null;

    const colon =
      digitCount === 4 && hasPin('COM') && hasPin('CLN')
        ? { com: net('COM'), cln: net('CLN') }
        : null;
    return { segments, digits, colon };
  }
  private lcdNets(partId: string): {
    rs: number;
    enable: number;
    d0: number;
    d4: number;
    d5: number;
    d6: number;
    d7: number;
  } | null {
    const netlist = this.currentNetlist;
    const net = (pin: string): number => {
      const found = netlist.pinNode.get(`${partId}:${pin}`);
      return found === undefined ? GROUND : found;
    };
    // A data line on the ground plane is a line the panel cannot read: the
    // nibble would come out as a run of zeroes no matter what the sketch did.
    const data = [net('D0'), net('D4'), net('D5'), net('D6'), net('D7')];
    if (data.some((n) => n === GROUND)) return null;
    return {
      rs: net('RS'),
      enable: net('E'),
      d0: data[0],
      d4: data[1],
      d5: data[2],
      d6: data[3],
      d7: data[4],
    };
  }

  /** The servo on a part, or undefined when it is not one. */
  servo(partId: string): Servo | undefined {
    return this.servos.get(partId);
  }

  /**
   * Records a driven-pin transition at `cycles` (16 MHz cpu cycles), with its
   * level carried explicitly so the pump pairs rises with falls without ever
   * depending on report ordering.
   *
   * Called by the AVR GPIO bridge on every output transition; the pump drains
   * these per solve into servo angles.
   */
  recordGpioEdge(gpio: number, cycles: number, high: boolean): void {
    const edges = this.gpioEdges.get(gpio) ?? [];
    edges.push({ cycles, high });
    while (edges.length > 64) edges.shift();
    this.gpioEdges.set(gpio, edges);
  }

  /**
   * Decodes servo pulses from the drained edge ring into `servo.write`.
   *
   * Runs post-solve beside the stepper and dialer pumps. Per gpio with edges,
   * the last completed HIGH width (16 cycles per microsecond) maps through the
   * stock Arduino Servo window (544–2400 µs over 0–180°) into the existing
   * clamp; widths outside 500–2500 µs are noise and ignored, and silence (no
   * completed pulse) leaves the horn — and its driven load — untouched.
   * Detaching stays a firmware-port-only operation.
   */
  pumpServoPulse(): void {
    if (this.gpioEdges.size === 0) return;
    for (const [gpio, edges] of this.gpioEdges) {
      let pending = this.servoPendingRise.get(gpio);
      let widthUs: number | null = null;
      for (const edge of edges) {
        if (edge.high) {
          pending = edge.cycles;
        } else if (pending !== undefined) {
          widthUs = (edge.cycles - pending) / 16;
          pending = undefined;
        }
      }
      if (pending !== undefined) this.servoPendingRise.set(gpio, pending);
      else this.servoPendingRise.delete(gpio);
      if (widthUs === null) continue;
      if (widthUs < 500 || widthUs > 2500) continue;
      const servo = this.servoOnGpio(gpio);
      if (!servo) continue;
      servo.write(Math.round(((widthUs - SERVO_MIN_US) / (SERVO_MAX_US - SERVO_MIN_US)) * 180));
      // The servo load is stamped around the netlist: same nets, new circuit,
      // so the solve cache must not reuse the pre-write answer.
      this.touch();
    }
    this.gpioEdges.clear();
  }

  /** The servo whose signal pin shares the board gpio's net, if there is one. */
  private servoOnGpio(gpio: number): Servo | null {
    if (!this.mcuPart) return null;
    const netlist = this.currentNetlist;
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (pinId === undefined) return null;
    const net = netlist.pinNode.get(`${this.mcuPart.id}:${pinId}`);
    if (net === undefined || net === GROUND) return null;
    for (const part of this.bench.parts) {
      const servo = this.servos.get(part.id);
      if (servo && netlist.pinNode.get(`${part.id}:PWM`) === net) return servo;
    }
    return null;
  }

  /** The character LCD on a part, or undefined when it is not one. */
  lcd(partId: string): Lcd1602 | undefined {
    return this.lcds.get(partId);
  }

  /**
   * Arms every character LCD's edge detector without solving.
   *
   * A strobe is a low settle that arms followed by a high settle that latches.
   * The low solve exists only to arm: data and enable levels are already known
   * from the pin writes, and the voltages it produces are discarded except for
   * the flag. Priming the flag directly skips one solve per nibble -- half the
   * solves of an LCD-heavy loop -- with identical latching, because the high
   * settle still observes the same levels.
   */
  primeLcdEdges(): void {
    for (const partId of this.lcds.keys()) this.lcdStrobe.set(partId, true);
  }

  /** Net of a board pin by firmware pin number, or null when not routable. */
  private netOfBoardGpio(netlist: Netlist, partId: string, gpio: number): number | null {
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (!pinId) return null;
    const net = netlist.pinNode.get(`${partId}:${pinId}`);
    return net === undefined || net === GROUND ? null : net;
  }

  /** Controller for a display part, or undefined if it is not a display. */
  displayController(partId: string): DisplayController | undefined {
    return this.displays.get(partId);
  }

  /**
   * True while a probe is watching.
   *
   * Time is only ever skipped when nothing is changing, but a probe needs to
   * observe what passes even when the circuit itself is settled: skipping over
   * a blink would leave the scope reporting whatever the solver happened to see
   * at the boundaries, which is aliasing rather than a waveform.
   */
  get isBeingProbed(): boolean {
    return this.probes.watchedNets.length > 0;
  }

  /**
   * Asks whichever device is at an address for `count` bytes.
   *
   * Empty when nothing on the bus answers, which is what a sketch sees when
   * the device is unplugged or wired to the wrong pins -- and, unlike a write,
   * a read has nothing to acknowledge, so silence is the only report there is.
   */
  requestI2C(address: number, count: number): readonly number[] {
    for (const [partId, device] of this.devices) {
      if (!device.onBus || device.address !== (address & 0x7f)) continue;
      if (!this.isOnI2cBus(partId)) continue;
      return device.read(count);
    }
    return [];
  }

  /** The I2C device a part is, if it is one. */
  i2cDevice(partId: string): I2cDevice | undefined {
    return this.devices.get(partId);
  }

  /**
   * Delivers one written byte to any device on the bus.
   *
   * Returns whether a device claimed the address, so an unplugged sensor makes
   * the transaction come back unacknowledged, as it would on a real bench.
   */
  writeI2C(address: number, byte: number, isControlPosition: boolean): boolean {
    let claimed = false;
    for (const [partId, device] of this.devices) {
      if (device.address !== (address & 0x7f) || !this.isOnI2cBus(partId)) continue;
      if (device.receive(byte, isControlPosition)) claimed = true;
    }
    return claimed;
  }

  /** True when a display's SDA and SCL both land on the firmware's I2C nets. */
  private isOnI2cBus(partId: string): boolean {
    const netlist = this.currentNetlist;
    const sda = netlist.pinNode.get(`${partId}:SDA`);
    const scl = netlist.pinNode.get(`${partId}:SCL`);
    if (sda === undefined || scl === undefined) return false;
    if (sda === GROUND || scl === GROUND) return false;
    return this.i2cNets.has(sda) && this.i2cNets.has(scl);
  }

  /**
   * Delivers one SPI byte to any display wired onto the SPI bus.
   *
   * Unlike I2C there is no address to acknowledge: the display is selected by
   * its chip-select pin alone, which is why a TFT on the wrong CS simply never
   * answers rather than reporting a fault.
   */
  deliverSpi(byte: number, dataSelect: boolean, chipSelected: boolean): void {
    for (const [partId, controller] of this.displays) {
      if (!this.isOnSpiBus(partId)) continue;
      if (controller instanceof Ili9341) controller.receive(byte, dataSelect, chipSelected);
      else if (controller instanceof Ssd1306) controller.receiveSpi(byte, dataSelect, chipSelected);
    }
  }

  /**
   * True when a display's CS, D/C, MOSI and SCK all land on the SPI nets.
   *
   * The gate the raw-byte path applies to every transaction, and the one the
   * `tft` convenience layer asks before handing a command to a panel: a
   * library reaches its panel over the same four signals, so a panel with one
   * of them unwired hears nothing.
   */
  isOnSpiBus(partId: string): boolean {
    const netlist = this.currentNetlist;
    for (const pin of ['CS', 'DC', 'MOSI', 'SCK']) {
      const net = netlist.pinNode.get(`${partId}:${pin}`);
      if (net === undefined || net === GROUND) return false;
      if (!this.spiNets.has(net)) return false;
    }
    return true;
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
   * True while time advance must stay on the fine 2 ms grid: live PWM
   * switches faster than coarse chunks may skip, and a watched probe must
   * observe what passes even when the circuit itself is settled. Capacitors
   * alone (a piezo disc, stray decoupling) ride coarse chunks: Backward
   * Euler is stable at any step and their edges still solve exactly, because
   * every firmware event settles on its own.
   */
  get needsFineSteps(): boolean {
    if (this.isBeingProbed) return true;
    for (const pin of this.mcu.pins()) {
      if (this.mcu.configurationOf(pin.id).pwm) return true;
    }
    return false;
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
    // A probe counts as a reason to keep solving even when nothing in the
    // circuit is moving: skipping past a blink would hand the scope whatever
    // the solver happened to see at the boundaries, which is aliasing.
    if (this.isBeingProbed) return true;
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
    this.advanceClocks();
    this.probes.capture(this.timeMs, (net) => this.voltageOfNet(net));
  }

  /**
   * Moves each real-time clock on with simulated time.
   *
   * A DS1307 has no crystal of its own in the model — its `setTime` exists to
   * be called as the bench's time moves, and until it is, every read answers
   * power-up zeros. The epoch matches the part's own power-up story: midnight,
   * 1 January 2000, advancing from there. Absolute rather than incremental, so
   * a `skip` that jumps time without solving still lands on the right second.
   *
   * A sketch that writes the time registers takes the calendar over in the
   * model, and the next step advances that set time rather than taking it
   * back — the alarm sketch sets the clock from its Hour/Minute buttons, so
   * taking it back froze the bench at midnight.
   */
  private advanceClocks(): void {
    for (const device of this.devices.values()) {
      if (device instanceof Ds1307) {
        device.setTime(new Date(RTC_EPOCH_MS + this.timeMs));
      }
    }
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
    this.advanceClocks();
    return this.solveAt(this.timeMs, dtSeconds);
  }

  /** Solves the circuit as it stands right now, without advancing time. */
  settle(): Solution {
    return this.solveAt(this.timeMs, 1e-5);
  }

  /** Reads a pin as a boolean, using the midpoint of the supply as the threshold. */
  readDigital(gpio: number): boolean {
    const memo = this.digitalReadMemo.get(gpio);
    if (memo !== undefined && memo.solution === this.solution && memo.netlist === this.netlist) {
      return memo.value;
    }
    const pinId = this.mcu.pinIdForGpio(gpio);
    const value = pinId === undefined ? false : this.readPinDigital(pinId);
    this.digitalReadMemo.set(gpio, {
      solution: this.solution,
      netlist: this.netlist,
      value,
    });
    return value;
  }

  readPinDigital(pinId: string): boolean {
    return this.voltageOfNet(this.netOfMcuPin(pinId)) >= this.mcu.board.logicVolts / 2;
  }

  /**
   * The top of the board's ADC scale, in counts.
   *
   * Exposed because MicroPython's `read_u16` has to translate the same range
   * into sixteen bits, and a second copy of this rule in the interpreter would
   * drift from the one the C++ path reads.
   */
  get adcFullScale(): number {
    return this.mcu.board.adcBits === 12 ? 4095 : 1023;
  }

  /** Reads a pin as an integer across the board's ADC range. */
  readAnalog(gpio: number): number {
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (!pinId) return 0;
    const volts = this.voltageOfNet(this.netOfMcuPin(pinId));
    const clamped = Math.min(this.mcu.board.logicVolts, Math.max(0, volts));
    return Math.round((clamped / this.mcu.board.logicVolts) * this.adcFullScale);
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
    let solution: Solution;
    if (
      this.solution !== null &&
      timeMs === this.solvedAtMs &&
      dtSeconds === this.solvedDt &&
      this.mcu.revision === this.solvedMcuRev &&
      this.topoRevision === this.solvedTopoRev &&
      this.elemRevision === this.solvedElemRev &&
      this.irControlKey() === this.solvedIrKey
    ) {
      // Same instant, timestep, pin intents, topology and stamped extras as
      // the last solve: the solver would answer identically, so its voltages
      // are reused and the pumps below observe them exactly as a fresh pass
      // would — including re-capturing the same probe samples.
      solution = this.solution;
    } else {
      let netlist = this.currentNetlist;
      let { elements, nodeCount } = this.buildElements(netlist, timeMs);

      solution = solveCircuit(elements, {
        nodeCount,
        dtSeconds,
        previousVoltages: this.previousVoltages,
      });

      this.solution = solution;
      // Both pumps run every solve: short-circuiting would starve one of them,
      // and one shared re-solve covers armature and transmission changes alike.
      const armaturesMoved = this.pumpRelays();
      const transmissionMoved = this.pumpIr();
      const scriptedMoved = this.pumpScripted(timeMs);
      if (armaturesMoved || transmissionMoved || scriptedMoved) {
        // An armature moved: the contact elements above are stale, so rebuild
        // the netlist once and re-solve. The coil is an independent resistor,
        // so its volts barely move with the contacts and one pass converges.
        netlist = buildNetlist(
          this.bench,
          this.dynamicState,
          this.relayEnergized,
          this.sonarMeasuring,
          this.irTransmitting !== null,
          this.scriptedValues,
        );
        this.netlist = netlist;
        this.topoRevision++;
        const rebuilt = this.buildElements(netlist, timeMs);
        elements = rebuilt.elements;
        nodeCount = rebuilt.nodeCount;
        solution = solveCircuit(elements, {
          nodeCount,
          dtSeconds,
          previousVoltages: this.previousVoltages,
        });
        this.solution = solution;
        this.pumpRelays();
      }
      this.solvedAtMs = timeMs;
      this.solvedDt = dtSeconds;
      this.solvedMcuRev = this.mcu.revision;
      this.solvedTopoRev = this.topoRevision;
      this.solvedElemRev = this.elemRevision;
      this.solvedIrKey = this.irControlKey();
    }
    // Shafts only move, never change topology, so one pump after the final
    // solve covers both paths above with no re-solve.
    this.pumpSteppers();
    this.pumpDialer();
    // Servo horns follow decoded pulse widths the same way: display state fed
    // every solve, never a re-solve of its own (a write only dirties the load
    // stamp for the next pass via touch()).
    this.pumpServoPulse();
    // Capacitor history only cares about real nets, so trim the internal rows.
    this.previousVoltages = solution.voltages.slice(0, this.currentNetlist.nodeCount);
    // Capture last, so a probe sees the voltages this solve produced rather
    // than the previous step's.
    this.probes.capture(this.timeMs, (net) => this.voltageOfNet(net));
    this.pumpLcds();
    this.pumpSevenSegments();
    return solution;
  }

  /**
   * Arms or releases a sonar echo measurement.
   *
   * Rebuilds the netlist when the flag moves so the ECHO line follows
   * within the same service call; settling after that solves the fresh
   * topology. A no-op when nothing changes.
   */
  setSonarMeasuring(partId: string, measuring: boolean): void {
    if ((this.sonarMeasuring.get(partId) ?? false) === measuring) return;
    if (measuring) this.sonarMeasuring.set(partId, true);
    else this.sonarMeasuring.delete(partId);
    this.netlist = buildNetlist(
      this.bench,
      this.dynamicState,
      this.relayEnergized,
      this.sonarMeasuring,
      this.irTransmitting !== null,
      this.scriptedValues,
    );
    this.topoRevision++;
    this.solution = null;
  }
  /** Shaft angle of a stepper part in degrees; axis 2 on a biaxial part. */
  stepperAngle(partId: string, axis: 1 | 2 = 1): number {
    return this.stepperState.get(partId)?.[axis - 1]?.angle ?? 0;
  }

  /**
   * Latches dialed digits from held dialers.
   *
   * While held the latch tracks the digit knob, so the hold-time value
   * wins; after release the last value stays put. Display state only --
   * no contacts move, so no re-solve is needed.
   */
  private pumpDialer(): void {
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'rotary-dialer') continue;
      if (!this.dynamicState.isPressed(part.id)) continue;
      this.dialedDigits.set(part.id, Math.round(this.dynamicState.knob(part.id, DIGIT_KNOB)));
    }
  }

  /** LED colors on a pixel part, in DIN order; empty with nothing there. */
  pixelColors(partId: string): ReadonlyArray<PixelColor> {
    return this.pixelBuffers.get(partId) ?? [];
  }

  /** Paints one LED; out-of-range indexes are ignored, channels clamp. */
  setPixel(partId: string, index: number, color: PixelColor): void {
    const buffer = this.pixelBuffers.get(partId);
    if (!buffer || !Number.isInteger(index) || index < 0 || index >= buffer.length) return;
    buffer[index] = {
      r: clampChannel(color.r),
      g: clampChannel(color.g),
      b: clampChannel(color.b),
    };
  }

  /** Shaft angles of single steppers, so the artwork can draw each rotor. */
  stepperAngles(): ReadonlyMap<string, number> {
    const angles = new Map<string, number>();
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'stepper') continue;
      angles.set(part.id, this.stepperAngle(part.id));
    }
    return angles;
  }

  /**
   * Advances stepper shafts from solved coil volts.
   *
   * Reads each winding differentially with a dead band, so identical
   * levels on both ends hold position instead of stepping. Runs after
   * the solve like the relay pump; shafts only move, never jump, so no
   * re-solve is needed -- contacts are unaffected.
   */
  private pumpSteppers(): void {
    const netlist = this.netlist;
    if (!netlist) return;
    const level = (partId: string, pinId: string): number => {
      const net = netlist.pinNode.get(`${partId}:${pinId}`) ?? GROUND;
      return this.voltageOfNet(net);
    };
    for (const part of this.bench.parts) {
      const kind = part.definition.component.kind;
      const axes =
        kind === 'stepper'
          ? [['A', 'B']]
          : kind === 'biaxial-stepper'
            ? [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ]
            : null;
      if (!axes) continue;
      let state = this.stepperState.get(part.id);
      if (!state || state.length !== axes.length) {
        state = axes.map(
          (_, index): { prevA: WindingPolarity; prevB: WindingPolarity; angle: number } => ({
            prevA: 0,
            prevB: 0,
            angle: state?.[index]?.angle ?? 0,
          }),
        );
        this.stepperState.set(part.id, state);
      }
      axes.forEach(([a, b], index) => {
        const nextA = windingPolarity(level(part.id, `${a}+`), level(part.id, `${a}-`));
        const nextB = windingPolarity(level(part.id, `${b}+`), level(part.id, `${b}-`));
        const axis = state[index];
        // Before the first driven sighting there is no edge to count yet:
        // arm the tracker and move on.
        if (axis.prevA === 0 && axis.prevB === 0 && nextA === 0 && nextB === 0) return;
        if (axis.prevA === 0 && axis.prevB === 0) {
          axis.prevA = nextA;
          axis.prevB = nextB;
          return;
        }
        // The previous levels always advance, even across an undriven
        // intermediate: a hop through zero breaks the edge it crossed, so
        // the far side never counts as a continuation.
        axis.angle += stepTransition([axis.prevA, axis.prevB], [nextA, nextB]) * STEP_DEGREES;
        axis.prevA = nextA;
        axis.prevB = nextB;
      });
    }
  }
  /**
   * Refreshes relay armature state from the solved coil volts.
   *
   * Returns whether any armature moved. Runs after the solve; the caller
   * re-solves once on change, so pull-in still costs at most one extra
   * pass. Reads both coil ends through the pin map, so an unwired coil
   * rests at 0 V and stays on NC.
   */
  /**
   * Asks the scripted parts, at the sampler's cadence, and says whether any
   * answer changed.
   *
   * A changed answer needs a fresh netlist because a scripted part *is* its
   * divider: the resistance is the reading. Unchanged answers are free -- that is
   * the whole reason the cadence exists, since the script call costs
   * microseconds and the rebuild costs a solve.
   */
  private pumpScripted(timeMs: number): boolean {
    const sampler = this.scriptedSampler;
    if (sampler === null) return false;
    if (timeMs - this.scriptedSampledAtMs < SCRIPTED_SAMPLE_MS) return false;
    this.scriptedSampledAtMs = timeMs;
    const next = sampler(timeMs, this.dynamicState);
    if (next.size === this.scriptedValues.size) {
      let same = true;
      for (const [id, value] of next) {
        if (this.scriptedValues.get(id) !== value) {
          same = false;
          break;
        }
      }
      if (same) return false;
    }
    this.scriptedValues = next;
    return true;
  }

  /**
   * Installs the scripted sampler (a backend's job, once its runtime is ready).
   *
   * Rebuilds, because a bench that had no sampler may have been built with every
   * scripted part reading zero, and the first sample is the correction.
   */
  /**
   * Installs the I2C half of the scripting bridge, or clears it.
   *
   * Two seams rather than one because the two halves are asked different
   * questions: the sampler answers "what does every part read now" for the
   * netlist, while a slave is asked one register question at the moment the bus
   * asks it. Both are reached the same way -- a closure the backend owns.
   */
  setScriptedI2c(scripted: ScriptedI2c | null): void {
    this.scriptedI2c = scripted;
  }

  /**
   * A control moved: the next solve re-reads the scripts, cadence or not.
   *
   * The cadence exists to bound rebuilds on a *running* bench, where simulated
   * time moves on its own. A knob turn is the operator saying the answer just
   * changed, and an idle bench has no next sample to wait for.
   */
  resampleScripted(): void {
    this.scriptedSampledAtMs = Number.NEGATIVE_INFINITY;
  }

  setScriptedSampler(sampler: ScriptedSampler | null): void {
    this.scriptedSampler = sampler;
    this.scriptedSampledAtMs = Number.NEGATIVE_INFINITY;
    if (sampler !== null) this.rebuild();
  }

  private pumpRelays(): boolean {
    const netlist = this.netlist;
    if (!netlist) return false;
    let changed = false;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'relay') continue;
      const plus = netlist.pinNode.get(`${part.id}:COIL+`) ?? GROUND;
      const minus = netlist.pinNode.get(`${part.id}:COIL-`) ?? GROUND;
      const volts = this.voltageOfNet(plus) - this.voltageOfNet(minus);
      const energized = coilEnergized(volts);
      if (this.relayEnergized.get(part.id) !== energized) {
        this.relayEnergized.set(part.id, energized);
        changed = true;
      }
    }
    return changed;
  }

  /** Live transmitted NEC code, or 0 with nothing in the air. */
  irCode(): number {
    return this.irTransmitting?.code ?? 0;
  }

  /**
   * Held-remote control state the IR pump reads.
   *
   * Keyed into the solve cache because no revision sees it: a press rebuilds
   * (nulling the cache), but turning the key knob mid-hold does not, and the
   * hold-time value must win on the very next solve.
   */
  private irControlKey(): string {
    let key = '';
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'ir-remote') continue;
      key += this.dynamicState.isPressed(part.id)
        ? `1:${this.dynamicState.knob(part.id, REMOTE_KEY_KNOB)};`
        : '0;';
    }
    return key;
  }

  /** Last dialed digit on a dialer part, or -1 before the first dial. */
  dialedDigit(partId: string): number {
    return this.dialedDigits.get(partId) ?? -1;
  }

  /** Bytes stored on one card, for enforcing the capacity cap. */
  sdBytes(partId: string): number {
    let total = 0;
    for (const text of this.sdFiles.get(partId)?.values() ?? []) total += text.length;
    return total;
  }

  /** Whether a card part is on the bench and answering. */
  sdBegin(partId: string): boolean {
    return this.bench.parts.some(
      (part) => part.id === partId && part.definition.component.kind === 'microsd',
    );
  }

  /**
   * Stores text under a name, replacing whatever was there.
   *
   * Returns the bytes stored, or 0 when the card is gone or the write
   * would pass the cap -- the old text stays put in both cases.
   */
  sdWrite(partId: string, name: string, text: string): number {
    if (!this.sdBegin(partId)) return 0;
    const files = this.sdFiles.get(partId) ?? new Map<string, string>();
    const usage = this.sdBytes(partId) - (files.get(name)?.length ?? 0) + text.length;
    if (usage > SD_CARD_BYTES) return 0;
    files.set(name, text);
    this.sdFiles.set(partId, files);
    return text.length;
  }

  /** Text under a name, or "" when missing or the card is gone. */
  sdRead(partId: string, name: string): string {
    if (!this.sdBegin(partId)) return '';
    return this.sdFiles.get(partId)?.get(name) ?? '';
  }

  /** 1 when a name exists on the card, else 0. */
  sdExists(partId: string, name: string): number {
    if (!this.sdBegin(partId)) return 0;
    return this.sdFiles.get(partId)?.has(name) ? 1 : 0;
  }

  /** Deletes a name; 1 when something was removed, else 0. */
  sdRemove(partId: string, name: string): number {
    if (!this.sdBegin(partId)) return 0;
    return this.sdFiles.get(partId)?.delete(name) ? 1 : 0;
  }

  /**
   * Refreshes IR transmission state from held remotes.
   *
   * Returns whether anything moved: a new code, a changed code, or an
   * expiry. The key knob is read live while held, so turning it mid-hold
   * follows the new key -- hold-time value wins, every solve.
   */
  private pumpIr(): boolean {
    let transmitting: { code: number; untilMs: number } | null = null;
    for (const part of this.bench.parts) {
      if (part.definition.component.kind !== 'ir-remote') continue;
      if (!this.dynamicState.isPressed(part.id)) continue;
      const index = Math.round(this.dynamicState.knob(part.id, REMOTE_KEY_KNOB));
      const key = NEC_CODES[Math.min(NEC_CODES.length - 1, Math.max(0, index))];
      transmitting = { code: key.code, untilMs: this.timeMs + IR_RELEASE_MS };
      break;
    }
    if (!transmitting && this.irTransmitting && this.timeMs < this.irTransmitting.untilMs) {
      return false;
    }
    const changed =
      (transmitting?.code ?? 0) !== (this.irTransmitting?.code ?? 0) ||
      (transmitting === null) !== (this.irTransmitting === null);
    this.irTransmitting = transmitting;
    return changed;
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

    // The meter is part of the circuit in amps and ohms mode, so it has to be
    // stamped rather than merely consulted.
    const meterElement = this.meter?.stamp();
    if (meterElement) elements.push(meterElement);
    // A servo is a load the firmware changes by command, so it is stamped here
    // rather than frozen into the netlist like the passive parts.
    for (const [partId, servo] of this.servos) {
      const supply = netlist.pinNode.get(`${partId}:V+`);
      const ground = netlist.pinNode.get(`${partId}:GND`);
      if (supply === undefined || ground === undefined) continue;
      elements.push({
        kind: 'resistor',
        a: supply,
        b: ground,
        ohms: servo.loadOhms,
        label: 'servo',
      });
    }
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
