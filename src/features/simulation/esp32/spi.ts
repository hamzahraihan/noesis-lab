/**
 * The emulated ESP32's SPI bus, as the host sees it.
 *
 * The classic chip's SPI master shifts bytes out on MOSI and reads MISO back:
 * a transaction is the bytes the controller shifted, not a waveform on two
 * pins. The devices on a bench live in the host, so the chip asks and the
 * host answers -- one call per byte.
 *
 * The bench's own SPI model is per byte and carries two things the chip's
 * master does not: the D/C line, which tells a display whether a byte is a
 * command or pixel data, and chip-select, which tells it that the transfer
 * it was in the middle of has been abandoned. On this board both are ordinary
 * GPIOs the sketch drives, so the seam reports their levels with every byte.
 *
 * The engine is the other end: it owns the parts, decides who is on the bus
 * and keeps the bus log. This file is the seam between the two, and it has
 * the same shape as the I2C seam, because the bench is one bus.
 */

/** The engine's side of the bus. */
export interface Esp32SpiSink {
  /** A transfer starts: chip-select has gone low. */
  begin(): void;
  /**
   * Delivers one byte.
   *
   * `dataSelect` is the D/C line's level: true means the byte is pixel data
   * rather than a command. `chipSelected` is false once chip-select has
   * risen, which abandons whatever command the device was in the middle of.
   * Answers the byte read back on MISO.
   */
  transfer(byte: number, dataSelect: boolean, chipSelected: boolean): number;
  /** Ends a transfer, so the bus log can close it. */
  end(): void;
}

/** The chip's side: the calls the master makes into the devices on the bus. */
export interface Esp32SpiDevice {
  /** A transfer starts. */
  begin(): void;
  /** One byte out; answers the byte read back on MISO. */
  byte(byte: number, dataSelect: boolean, chipSelected: boolean): number;
  /** The transfer ends. */
  end(): void;
}

/**
 * Builds the device the chip's master talks to.
 *
 * The master shifts a byte and takes back the byte the device shifted in on
 * MISO, so this is a straight translation: the byte goes to the bench's bus
 * with the level of the D/C line, and whatever the bus answers comes back.
 *
 * The framing is the bus's, not the chip's: a transfer runs from chip-select
 * going low to it going back high, and the bus log closes it there. The chip
 * knows the two lines only as pins, so the levels travel with the bytes.
 */
export function esp32SpiDevice(sink: Esp32SpiSink): Esp32SpiDevice {
  return {
    begin(): void {
      sink.begin();
    },
    byte(byte: number, dataSelect: boolean, chipSelected: boolean): number {
      return sink.transfer(byte, dataSelect, chipSelected) & 0xff;
    },
    end(): void {
      sink.end();
    },
  };
}
