/**
 * MCP23017: sixteen pins in two wires.
 *
 * The PCF8574 answers the board's pin shortage with one byte. This chip
 * answers it with two ports and a direction register: every pin can be an
 * input or an output, and the sketch says which by clearing a bit in IODIR.
 * The power-up state is all inputs, so a sketch that writes a latch without
 * setting the direction changes nothing on the pins -- which is the mistake
 * the part exists to teach.
 *
 * The bench models bank 0, the register map the chip powers up in: IODIRA and
 * IODIRB at 0x00 and 0x01, the output latches at 0x14 and 0x15, and the GPIO
 * registers at 0x12 and 0x13. The direction register also decides where a
 * GPIO read comes from: a pin the chip drives reads back its latch, and a pin
 * it listens to reads the level the wiring holds. The pull-up registers are
 * stamped as the ~100k the chip really has, so an input with its pull-up
 * enabled sits at the supply until something pulls it down. The interrupt
 * registers raise INTA and INTB: a pin named in GPINTEN and left an input is
 * watched, and a change (or, with INTCON, a level that differs from DEFVAL)
 * sets its bit in INTF, captures the port in INTCAP, and pulls the interrupt
 * output. Only a port read or a capture read takes the flag down; the flag
 * register is a report, not a control.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers on, with the address straps open. */
export const MCP23017_ADDRESS = 0x20;

/** How many ports the chip has: two banks of eight. */
export const MCP23017_PORTS = 16;

/**
 * The output stage, in ohms.
 *
 * The chip's outputs are push-pull, and the bench gives them the same output
 * impedance it gives the other expander so a driven pin reads as driven.
 */
export const MCP23017_OUTPUT_OHMS = 1000;

/** The port holes, in the order the register banks number them. */
export const MCP23017_PORT_PINS = [
  'PA0',
  'PA1',
  'PA2',
  'PA3',
  'PA4',
  'PA5',
  'PA6',
  'PA7',
  'PB0',
  'PB1',
  'PB2',
  'PB3',
  'PB4',
  'PB5',
  'PB6',
  'PB7',
] as const;

/**
 * The level the bench finds on one port pin.
 *
 * The chip has no way to know what is connected to it: it samples the pin,
 * which is the solver's job rather than the model's. The engine installs this
 * so a GPIO read can answer for the pins the sketch is not driving.
 */
export type Mcp23017PinLevels = (index: number) => boolean;

/**
 * The internal pull-up, in ohms.
 *
 * The chip's datasheet calls the input pull-ups a typical 100k, and the bench
 * stamps the real value: an unwired input with its pull-up enabled sits at the
 * rail, and a wire to ground still wins over it. That is the lesson the
 * register carries, so it is a resistor rather than a reading that lies.
 */
export const MCP23017_PULLUP_OHMS = 100_000;

/** Bank-0 registers, as the datasheet numbers them. */
const IODIR_A = 0x00;
const IODIR_B = 0x01;
const IPOL_A = 0x02;
const IPOL_B = 0x03;
// GPINTEN, DEFVAL and INTCON are a pair each; the second is the first plus one.
const GPINTEN_A = 0x04;
const DEFVAL_A = 0x06;
const INTCON_A = 0x08;
const IOCON_A = 0x0a;
const IOCON_B = 0x0b;
const GPPU_A = 0x0c;
const GPPU_B = 0x0d;
const INTF_A = 0x0e;
const INTF_B = 0x0f;
const INTCAP_A = 0x10;
const INTCAP_B = 0x11;
const GPIO_A = 0x12;
const GPIO_B = 0x13;
const OLAT_A = 0x14;
const OLAT_B = 0x15;

/** IOCON: the interrupt output is active high rather than active low. */
const IOCON_INTPOL = 0x02;
/** IOCON: the interrupt output is open-drain, which overrides INTPOL. */
const IOCON_ODR = 0x04;
/** IOCON: the two interrupt pins are connected internally, so both carry it. */
const IOCON_MIRROR = 0x40;
/** One past the last bank-0 register: a burst wraps back to IODIRA here. */
const REGISTER_COUNT = 0x16;

export class Mcp23017 implements I2cDevice {
  readonly address = MCP23017_ADDRESS;
  onBus = false;

  /**
   * Every bank-0 register, in datasheet order. Power-up has the direction
   * registers set to all ones, so every port starts as an input.
   */
  private readonly registers = new Uint8Array(REGISTER_COUNT);
  /** Which register the next byte goes to or comes from. */
  private pointer = IODIR_A;
  /** The bench's view of the pins, installed by the engine on every rebuild. */
  private pinLevels: Mcp23017PinLevels | null = null;
  /** What each port held at the last sample: the wire, or the latch if driven. */
  private readonly sampled = new Uint8Array(2);
  /** False until the first sample, so power-up is not an interrupt. */
  private sampledOnce = false;

  constructor() {
    this.registers[IODIR_A] = 0xff;
    this.registers[IODIR_B] = 0xff;
  }

  /**
   * One byte of a transaction.
   *
   * The first byte names the register; every byte after it lands in that
   * register and moves the pointer on, so a sketch can write both directions
   * or both latches in one burst. Writes past the last register wrap to the
   * first, which is the chip's sequential mode.
   */
  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte % REGISTER_COUNT;
      return true;
    }
    this.writeRegister(this.pointer, byte & 0xff);
    this.pointer = (this.pointer + 1) % REGISTER_COUNT;
    return true;
  }

  /** Reads the register file from the current pointer, wrapping like a burst. */
  read(count: number): readonly number[] {
    const out: number[] = [];
    for (let index = 0; index < Math.max(0, count); index++) {
      out.push(this.readRegister(this.pointer));
      this.pointer = (this.pointer + 1) % REGISTER_COUNT;
    }
    return out;
  }

  /** The level the latch is holding for a port, whether or not it is an output. */
  output(index: number): boolean {
    return (this.latch(index) >> (index % 8) & 1) === 1;
  }

  /**
   * Installs the bench's view of the pins.
   *
   * A port the sketch left an input is answered from here -- the wiring, not
   * the latch -- so it is the engine that supplies the reading. Called on
   * every rebuild, because the device is carried across them while the
   * netlist underneath it is not.
   */
  setPinLevels(levels: Mcp23017PinLevels): void {
    this.pinLevels = levels;
  }

  /** Whether a port is configured to drive its pin rather than listen to it. */
  isOutput(index: number): boolean {
    const directions = index < 8 ? this.registers[IODIR_A]! : this.registers[IODIR_B]!;
    return (directions >> (index % 8) & 1) === 0;
  }

  /**
   * Whether an input pin has its internal pull-up switched on.
   *
   * Only an input can use it: the chip's output stage is push-pull, so a pin
   * the sketch drives ignores the pull-up bit. The engine stamps the resistor
   * into the solve rather than the model deciding a level, so a wire to ground
   * still beats the pull-up.
   */
  pullUp(index: number): boolean {
    const pulls = index < 8 ? this.registers[GPPU_A]! : this.registers[GPPU_B]!;
    return (pulls >> (index % 8) & 1) === 1;
  }

  /**
   * Samples the pins, the way the chip does between transactions.
   *
   * The engine calls this once per solve with the level on every port. A pin
   * the sketch is driving is not watched -- an output has no interrupt -- but
   * it does take part in the byte a capture reports, and that byte is the
   * latch: the level the chip is putting out, which is what a read of the port
   * would have shown.
   *
   * `INTCON` chooses what counts. A zero compares against the level the pin
   * held at the last sample, so any edge is an interrupt; a one compares
   * against `DEFVAL`, so the flag follows a level rather than a transition.
   * Either way the matching bit lands in `INTF`, and `INTCAP` keeps the byte
   * the port held when it happened, for a sketch that needs to know what the
   * pins were doing and not merely that they moved.
   */
  updateInputs(levels: readonly boolean[]): void {
    const now = new Uint8Array(2);
    for (let port = 0; port < 2; port++) {
      for (let bit = 0; bit < 8; bit++) {
        const index = port * 8 + bit;
        const high = this.isOutput(index) ? this.output(index) : levels[index] === true;
        if (high) now[port] = now[port]! | (1 << bit);
      }
    }
    /*
     * The first sample is only a baseline: an edge needs a level before it. A
     * DEFVAL comparison does not, because that mode watches a level rather
     * than a transition, and a pin already sitting away from its default is
     * an interrupt from the moment the sketch asks for one.
     */
    const primed = this.sampledOnce;
    for (let port = 0; port < 2; port++) {
      // Only an input can be a source: the chip's output stage is push-pull,
      // so a GPINTEN bit set for a pin the sketch drives does nothing.
      const enabled = this.registers[GPINTEN_A + port]! & this.registers[IODIR_A + port]!;
      const current = now[port]!;
      if (enabled !== 0) {
        const compares = this.registers[INTCON_A + port]!;
        const defval = this.registers[DEFVAL_A + port]!;
        const changed = primed ? (this.sampled[port]! ^ current) & enabled : 0;
        let hit = 0;
        for (let bit = 0; bit < 8; bit++) {
          const mask = 1 << bit;
          if ((enabled & mask) === 0) continue;
          const matches =
            (compares & mask) !== 0 ? ((current ^ defval) & mask) !== 0 : (changed & mask) !== 0;
          if (matches) hit |= mask;
        }
        if (hit !== 0) {
          this.registers[INTF_A + port] = this.registers[INTF_A + port]! | hit;
          this.registers[INTCAP_A + port] = current;
        }
      }
      this.sampled[port] = current;
    }
    this.sampledOnce = true;
  }

  /**
   * The level an interrupt output is driving, or null when it is not driving.
   *
   * A push-pull output always drives: low while asserted, which is what a
   * button-style active-low signal expects, and high when `INTPOL` is set. An
   * open-drain output (`ODR`) only pulls towards the active level and releases
   * otherwise, and `ODR` overrides `INTPOL` -- the datasheet says so, and it is
   * why an open-drain interrupt needs a pull-up on the wire. With `MIRROR` set
   * the two pins are internally connected: both carry either port's flag, so
   * either one can be wired to the host.
   */
  interruptLevel(port: 0 | 1): boolean | null {
    const iocon = this.registers[IOCON_A]!;
    const mirrored = (iocon & IOCON_MIRROR) !== 0;
    const asserted = mirrored
      ? (this.registers[INTF_A]! | this.registers[INTF_B]!) !== 0
      : this.registers[port === 0 ? INTF_A : INTF_B]! !== 0;
    if ((iocon & IOCON_ODR) !== 0) return asserted ? false : null;
    const activeHigh = (iocon & IOCON_INTPOL) !== 0;
    return asserted ? activeHigh : !activeHigh;
  }

  private writeRegister(register: number, value: number): void {
    // INTF and INTCAP are the chip's report to the sketch, not its controls.
    if (
      register === INTF_A ||
      register === INTF_B ||
      register === INTCAP_A ||
      register === INTCAP_B
    ) {
      return;
    }
    // Both addresses name the one configuration register, so a write to
    // either is a write to the same byte.
    if (register === IOCON_A || register === IOCON_B) {
      this.registers[IOCON_A] = value;
      this.registers[IOCON_B] = value;
      return;
    }
    if (register === GPIO_A || register === OLAT_A) {
      this.registers[OLAT_A] = value;
      return;
    }
    if (register === GPIO_B || register === OLAT_B) {
      this.registers[OLAT_B] = value;
      return;
    }
    this.registers[register] = value;
  }

  private readRegister(register: number): number {
    /*
     * The flag is cleared by the read that consumes it: the port itself or the
     * capture. The flags register is different -- it is the chip's report of
     * which pin fired, so reading it leaves the interrupt asserted, which is
     * what the datasheet says. A sketch that wants the byte the pins held at
     * the edge reads INTCAP first, because reading GPIO afterwards has cleared
     * the flag.
     */
    if (register === GPIO_A) {
      const value = this.gpio(0, this.registers[IPOL_A]!);
      this.registers[INTF_A] = 0;
      return value;
    }
    if (register === GPIO_B) {
      const value = this.gpio(8, this.registers[IPOL_B]!);
      this.registers[INTF_B] = 0;
      return value;
    }
    if (register === INTF_A || register === INTF_B) return this.registers[register]!;
    if (register === INTCAP_A || register === INTCAP_B) {
      const value = this.registers[register]!;
      this.registers[register === INTCAP_A ? INTF_A : INTF_B] = 0;
      return value;
    }
    if (register === OLAT_A) return this.latch(0);
    if (register === OLAT_B) return this.latch(8);
    return this.registers[register] ?? 0;
  }

  /**
   * A GPIO read, pin by pin.
   *
   * A bit whose direction is an output reports the latch: that is the level
   * the chip is putting on the pin. A bit whose direction is an input reports
   * the wiring, which is the whole reason the register exists -- otherwise a
   * sketch reading a button would be reading back the byte it wrote, and a
   * press would be whatever the last write happened to say.
   *
   * Polarity is applied last, to both halves at once, because IPOL inverts the
   * value a read reports rather than the level on the pin.
   */
  private gpio(base: number, polarity: number): number {
    const directions = this.registers[base === 0 ? IODIR_A : IODIR_B]!;
    const latch = this.latch(base);
    let value = 0;
    for (let bit = 0; bit < 8; bit++) {
      const driven = (directions >> bit & 1) === 0;
      const high = driven
        ? (latch >> bit & 1) === 1
        : this.pinLevels !== null && this.pinLevels(base + bit);
      if (high) value |= 1 << bit;
    }
    return (value ^ polarity) & 0xff;
  }

  private latch(index: number): number {
    return index < 8 ? this.registers[OLAT_A]! : this.registers[OLAT_B]!;
  }
}

/**
 * The module as it is sold: a small breakout with the chip on it, the four
 * bus wires along the top, the two interrupt outputs beside them and sixteen
 * ports in two rows below.
 */
export function mcp23017Definition(): PartDefinition {
  const pins = [
    { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
    { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
    { id: 'SDA', label: 'SDA', x: 7.62, y: 4.0 },
    { id: 'SCL', label: 'SCL', x: 10.16, y: 4.0 },
    { id: 'INTA', label: 'INTA', x: 12.7, y: 4.0 },
    { id: 'INTB', label: 'INTB', x: 15.24, y: 4.0 },
  ];
  for (let index = 0; index < MCP23017_PORTS; index++) {
    const row = Math.floor(index / 8);
    pins.push({
      id: MCP23017_PORT_PINS[index]!,
      label: MCP23017_PORT_PINS[index]!,
      x: 2.54 + (index % 8) * 2.54,
      y: 20.0 + row * 5.08,
    });
  }
  return {
    id: 'mcp23017',
    name: 'I/O expander (MCP23017)',
    category: 'output',
    widthMm: 25.4,
    heightMm: 29.0,
    component: { kind: 'mcp23017' },
    pins,
    bodyColour: '#3b0764',
    legendColour: '#f3e8ff',
  };
}
