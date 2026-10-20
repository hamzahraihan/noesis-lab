/**
 * The emulated ESP32's I2C bus, as the host sees it.
 *
 * The classic chip's I2C controller is a master that exchanges bytes with
 * attached devices: a transaction is the controller's calls into a device,
 * not a waveform on two pins. The devices on a bench live in the host, so
 * the chip asks and the host answers -- one call per phase of a transfer.
 *
 * The engine is the other end: it owns the parts, decides who is on the bus
 * and keeps the bus log. This file is the seam between the two, and it has
 * the same shape as the RP2040's bridge, because the bench is one bus.
 */

/** The engine's side of the bus. */
export interface Esp32I2cSink {
  /** Whether a device answers at this address on the bus. */
  hasDevice(address: number): boolean;
  /** Delivers one written byte; answers whether a device claimed it. */
  writeByte(address: number, byte: number, isFirst: boolean): boolean;
  /** Fetches one read byte, counted from the start of the read. */
  readByte(address: number, index: number): number;
  /** Ends a write transfer, so the bus log can close it. */
  writeEnd(): void;
}

/**
 * The chip's side: the calls the controller makes into the device it
 * addressed.
 */
export interface Esp32I2cDevice {
  /**
   * The address phase: the master addressed this device, for a read or a
   * write. Answers whether the device acknowledged.
   */
  start(address: number, read: boolean): boolean;
  /** One data byte from the master. Answers whether the device acknowledged. */
  write(address: number, byte: number): boolean;
  /** One data byte to the master. */
  read(address: number): number;
  /** The end of the transfer. */
  stop(address: number): void;
}

/**
 * Builds the device the chip's controller talks to.
 *
 * The controller asks the device who acknowledged each phase and waits for
 * the answer, so this is the same shape as the AVR TWI bridge: the address
 * phase is acknowledged when a device is on the bus at that address, each
 * written byte reports whether a device claimed it, and a read is fetched a
 * byte at a time. A device that is not there is not acknowledged, which is
 * what a master sees on a real bus and what the firmware has to be able to
 * reproduce.
 *
 * A read that nobody answers comes back as 0xff rather than hanging the
 * firmware, and the first byte of a write is the control position: the
 * engine's devices take a register pointer there, as they do on every other
 * path into the bus.
 *
 * Pin muxing is not consulted: the board model declares which nets carry the
 * bus, and the engine decides whether a device is on them. The chip routing
 * its I2C elsewhere therefore still reaches the devices on the board's
 * declared pair -- the same limit the interpreter's `machine.I2C` has.
 */
export function esp32I2cDevice(sink: Esp32I2cSink): Esp32I2cDevice {
  /** Bytes written in the phase that is open. */
  let written = 0;
  /** True while the open phase is a write. */
  let writePhase = false;
  /** Bytes read since the read phase began. */
  let readIndex = 0;

  return {
    start(address, read) {
      // A repeated start ends the write that came before it: the bus log
      // closes that transfer here, and the read that follows starts a new
      // one at the device's own pointer.
      if (writePhase) sink.writeEnd();
      writePhase = !read;
      written = 0;
      readIndex = 0;
      return sink.hasDevice(address);
    },

    write(address, byte) {
      const claimed = sink.writeByte(address, byte, written === 0);
      written += 1;
      return claimed;
    },

    read(address) {
      const value = sink.readByte(address, readIndex);
      readIndex += 1;
      return value & 0xff;
    },

    stop() {
      if (writePhase) sink.writeEnd();
      writePhase = false;
    },
  };
}
