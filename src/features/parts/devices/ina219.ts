/**
 * INA219 current and power monitor: the breakout that watches a supply and
 * says how much current is running through it.
 *
 * The model speaks the register protocol rather than offering a "how many
 * milliamps" call, because the protocol is the whole exercise. The chip
 * reports the voltage across its shunt, the voltage on the bus it is watching,
 * and the current and power derived from those -- and the current it reports
 * is only as good as the calibration register the sketch wrote, which is the
 * part of the exercise that catches people out.
 *
 * The shunt is the chip's own: a hundredth of an ohm across the two pins the
 * load runs through. A sketch that divides the shunt voltage by that
 * resistance gets the current without touching the calibration register at
 * all, and a sketch that reads the current register instead has to write the
 * calibration first, exactly as on the real chip.
 *
 * The registers are sixteen bits wide and big-endian, and the register
 * address is the first byte of the write: `[address][high][low]`, and the
 * same address again with a restart for the read. A read of more than two
 * bytes carries on into the registers after it, which is how a sketch reads
 * the shunt voltage, the bus voltage and the power in one go.
 */
import { type KnobSpec } from '../catalog';
import { type I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const INA219_ADDRESS = 0x40;

/** The voltage of the bus the chip is watching, in volts. */
export const INA219_BUS_KNOB: KnobSpec = {
  id: 'bus',
  label: 'Bus voltage',
  min: 0,
  max: 26,
  step: 0.1,
  unit: 'V',
  defaultValue: 5,
};

/** The current running through the chip's shunt, in milliamps. */
export const INA219_CURRENT_KNOB: KnobSpec = {
  id: 'current',
  label: 'Current',
  min: 0,
  max: 3000,
  step: 10,
  unit: 'mA',
  defaultValue: 100,
};

/**
 * The resistance of the shunt on the module, in ohms.
 *
 * A hundredth of an ohm is what these breakouts carry: at two amps it drops
 * two hundred millivolts, which the chip's own gain setting is sized for.
 */
export const INA219_SHUNT_OHMS = 0.1;

/** The shunt voltage register's least significant bit, in volts. */
const SHUNT_LSB = 10e-6;
/** The bus voltage register's least significant bit, in volts. */
const BUS_LSB = 4e-3;

/** The registers, in the order the datasheet numbers them. */
const CONFIG = 0x00;
const SHUNT_VOLTAGE = 0x01;
const BUS_VOLTAGE = 0x02;
const POWER = 0x03;
const CURRENT = 0x04;
const CALIBRATION = 0x05;

/** The number of registers the chip answers at. */
const REGISTER_COUNT = 6;

/** The flags the bus voltage register carries below its reading. */
const CONVERSION_READY = 0x0002;
const OVERFLOW = 0x0001;

/** The shunt measurement's full scale, in millivolts, for each gain setting. */
const SHUNT_RANGES_MV = [40, 80, 160, 320] as const;

export class Ina219 implements I2cDevice {
  readonly address = INA219_ADDRESS;
  onBus = false;

  /** The voltage of the bus being watched, in volts. */
  private busVolts = 5;
  /** The current through the shunt, in amps. */
  private amps = 0.1;

  /** The registers the chip holds, each two bytes, most significant first. */
  private readonly registers = new Uint8Array(REGISTER_COUNT * 2);
  /** The register the chip is pointed at. */
  private pointer = CONFIG;
  /** Which byte of that register the next written byte lands in. */
  private byteIndex = 0;
  /** Whether the last refresh overflowed the shunt's range. */
  private overflowed = false;
  /**
   * Where the supply is.
   *
   * The chip reads the world when it reports rather than being told about it,
   * so a knob turned between two reads is seen by the very next one -- in the
   * page and in the worker alike, which is where a pushed value would have
   * gone stale.
   */
  private world: (() => { readonly busVolts: number; readonly amps: number }) | null = null;

  constructor() {
    // The chip powers up in shunt-and-bus continuous mode on the widest
    // range, which is the datasheet's own reset value: thirty-two volts,
    // three hundred and twenty millivolts across the shunt, and converting
    // without a sketch asking it to.
    this.writeWord(CONFIG, 0x399f);
    this.refresh();
  }

  /** Points the chip at the supply the bench is in. */
  setConditionsSource(read: () => { readonly busVolts: number; readonly amps: number }): void {
    this.world = read;
  }

  /** The supply the chip is watching, as the world describes it. */
  private conditions(): boolean {
    if (this.world === null) return false;
    const { busVolts, amps } = this.world();
    if (busVolts === this.busVolts && amps === this.amps) return false;
    this.busVolts = busVolts;
    this.amps = amps;
    return true;
  }

  /**
   * Repacks the chip's registers from the supply it is watching.
   *
   * The shunt voltage is the current through the shunt times the shunt's own
   * resistance, and it is limited by the gain the sketch set: a reading past
   * the range saturates and says so. The bus voltage is the supply,
   * left-aligned in its register with the flags below it. The current and
   * the power are the chip's own arithmetic on the calibration the sketch
   * wrote -- and with no calibration written they are not available at all,
   * which is what the real chip says about its own registers.
   *
   * A chip in power-down mode takes no new measurements, so its registers
   * keep the last reading they had.
   */
  private refresh(): void {
    if (this.mode() === 0) return;
    const shuntVolts = this.amps * INA219_SHUNT_OHMS;
    const range = SHUNT_RANGES_MV[this.gain()] / 1000;
    this.overflowed = Math.abs(shuntVolts) > range;
    const clamped = Math.max(-range, Math.min(range, shuntVolts));
    this.writeWord(SHUNT_VOLTAGE, Math.round(clamped / SHUNT_LSB));
    const bus = Math.round(this.busVolts / BUS_LSB);
    const flags = CONVERSION_READY | (this.overflowed ? OVERFLOW : 0);
    this.writeWord(BUS_VOLTAGE, (bus << 3) | flags);
    const currentLsb = this.currentLsb();
    if (currentLsb === 0) {
      this.writeWord(CURRENT, 0);
      this.writeWord(POWER, 0);
      return;
    }
    this.writeWord(CURRENT, Math.round(this.amps / currentLsb));
    this.writeWord(POWER, Math.round((this.busVolts * this.amps) / (20 * currentLsb)));
  }

  /** The gain the configuration register asks for: zero is the finest. */
  private gain(): number {
    return (this.readWord(CONFIG) >> 11) & 0x03;
  }

  /** The mode the configuration register asks for; zero is power-down. */
  private mode(): number {
    return this.readWord(CONFIG) & 0x07;
  }

  /**
   * The current per bit the calibration register asks for, in amps.
   *
   * The datasheet's own relation: the calibration word is
   * `0.04096 / (current LSB * shunt resistance)`, so the chip's registers are
   * only as fine as the sketch asked them to be. A calibration of zero is the
   * chip's power-up state, and the current and power registers are invalid
   * until it is written.
   */
  private currentLsb(): number {
    const calibration = this.readWord(CALIBRATION) & 0xffff;
    if (calibration === 0) return 0;
    return 0.04096 / (calibration * INA219_SHUNT_OHMS);
  }

  /** Writes a register that holds a sixteen-bit value, most significant first. */
  private writeWord(register: number, value: number): void {
    const word = value & 0xffff;
    this.registers[register * 2] = (word >> 8) & 0xff;
    this.registers[register * 2 + 1] = word & 0xff;
  }

  /** Reads a register that holds a sixteen-bit value, most significant first. */
  private readWord(register: number): number {
    return (this.registers[register * 2] << 8) | this.registers[register * 2 + 1];
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0x07;
      this.byteIndex = 0;
      return true;
    }
    this.write(this.pointer, this.byteIndex, byte);
    this.byteIndex += 1;
    if (this.byteIndex === 2) {
      // A register is two bytes wide, so the next byte belongs to the
      // register after it.
      this.pointer = (this.pointer + 1) & 0x07;
      this.byteIndex = 0;
    }
    return true;
  }

  read(count: number): readonly number[] {
    if (this.conditions()) this.refresh();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      const register = this.pointer + (index >> 1);
      out.push(this.registerByte(register, index % 2 === 0));
    }
    return out;
  }

  /** One byte of a register: the high byte first, the low byte second. */
  private registerByte(register: number, high: boolean): number {
    if (register >= REGISTER_COUNT) return 0;
    return this.registers[register * 2 + (high ? 0 : 1)];
  }

  /**
   * Handles a written byte.
   *
   * The configuration and the calibration are the chip's own settings, and a
   * write to either changes what the chip reports -- so the registers are
   * recomputed against the new setting rather than left stale. The
   * measurement registers are the chip's own: a write to them changes
   * nothing, which is what the chip does.
   */
  private write(register: number, byteIndex: number, value: number): void {
    if (register !== CONFIG && register !== CALIBRATION) return;
    this.registers[register * 2 + byteIndex] = value & 0xff;
    if (byteIndex === 1) {
      this.conditions();
      this.refresh();
    }
  }
}
