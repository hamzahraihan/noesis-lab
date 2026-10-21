/**
 * Devices that answer on the I2C bus.
 *
 * The bus moves bytes and decides nothing; what a device does with them is the
 * device's business. That split is the whole reason a clock, an accelerometer
 * and a load-cell amplifier can share two wires: each claims its own address,
 * and nothing on the bus sees another device's traffic.
 *
 * A device is only reachable when it is actually wired to the firmware's bus.
 * That is not a detail: the whole failure worth being able to reproduce is a
 * sensor on the wrong pins, answering nothing, rather than working regardless.
 */

export interface I2cDevice {
  /** Seven-bit address the device answers to. */
  readonly address: number;
  /** Set by the engine each time the bench is rebuilt. */
  onBus: boolean;
  /**
   * Handles one written byte, false when the device did not recognise it.
   *
   * `isControlPosition` is true for the first byte of a transaction, which
   * matters on devices whose first byte is a register pointer rather than data.
   */
  receive(byte: number, isControlPosition: boolean): boolean;
  /**
   * Answers a read of `count` bytes, from wherever the last write left the
   * device's pointer.
   */
  read(count: number): readonly number[];
}

/**
 * The half of a scripted slave the device needs, without the script in it.
 *
 * Declared here rather than in the simulation feature on purpose: the device is a
 * part, the runtime belongs to the solver, and the seam between them is two
 * methods. It keeps the dependency pointing the way the boundary gate insists on
 * -- `parts` never reaches into `simulation` for a value.
 */
export interface ScriptedI2cSlave {
  /**
   * The bytes the slave answers for a read of `count` at `register`.
   *
   * Null is "no answer at all" -- a faulted or absent script -- which the bus
   * reads as a NACK. An empty or short array is different: that is a device
   * answering, and the bus repeats its last byte rather than refusing.
   */
  read(register: number, count: number): readonly number[] | null;
  /** False when the slave refused, which the bus answers as a NACK. */
  write(register: number, bytes: readonly number[]): boolean;
}

/**
 * A device that answers on the SPI bus.
 *
 * Unlike I2C there is no address to acknowledge: a device is selected by its
 * chip-select pin alone, which is why a panel on the wrong CS simply never
 * answers rather than reporting a fault.
 */
export interface SpiDevice {
  /**
   * One byte out to the device.
   *
   * `dataSelect` is the data/command line's level, and `chipSelected` is false
   * once the chip-select has risen -- which is how a device knows a command
   * was abandoned half way.
   */
  receive(byte: number, dataSelect: boolean, chipSelected: boolean): void;
}

/**
 * A read that runs off the end of what a device has.
 *
 * I2C has no way to say "there is nothing more": a device that answers fewer
 * bytes than asked simply repeats its last one, and a sketch that reads past
 * the end gets that rather than a fault. Which is what a real bus does.
 */
export function repeatLast(bytes: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < count; index++) {
    out.push(bytes[index] ?? bytes[bytes.length - 1] ?? 0);
  }
  return out;
}
