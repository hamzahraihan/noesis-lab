/**
 * A slave whose registers are a script's business.
 *
 * Every shipped I2C part is a class here because its datasheet is known. This is
 * the other case: the file carries the behaviour, so the device is a thin
 * translation between the bus's byte-at-a-time conversation and the script's
 * register-shaped one.
 *
 * The translation is exactly what the ABI promises. The bus's first byte of a
 * transaction is the register pointer (that is what `isControlPosition` means),
 * so the device remembers it and hands the script `{ register, bytes }`; a read
 * asks for the register the pointer landed on, and a short answer is repeated the
 * way a real slave repeats its last byte rather than refusing.
 */

import { repeatLast, type I2cDevice, type ScriptedI2cSlave } from './device';

export class ScriptedI2cDevice implements I2cDevice {
  /** Set by the engine each time the bench is rebuilt. */
  onBus = false;
  /** Where the master's last control byte left the pointer. */
  private register = 0;

  readonly address: number;
  private readonly slave: ScriptedI2cSlave;

  constructor(address: number, slave: ScriptedI2cSlave) {
    this.address = address;
    this.slave = slave;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.register = byte;
      return true;
    }
    // One byte at a time, because that is how the bus arrives: a script that
    // needs multi-byte semantics keeps its own state, which real JS allows.
    return this.slave.write(this.register, [byte]);
  }

  read(count: number): readonly number[] {
    const answer = this.slave.read(this.register, count);
    // No answer is a NACK, not a row of zeros: a faulted slave must not look
    // like a healthy one reporting the value zero.
    return answer === null ? [] : repeatLast(answer, count);
  }
}
