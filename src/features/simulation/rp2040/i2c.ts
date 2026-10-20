import { I2CMode } from 'rp2040js';

/** Structural subset of the engine's I2C sink, matching `AvrHooks.i2c`. */
export interface Rp2040I2cSink {
  writeByte(address: number, byte: number, isFirst: boolean): boolean;
  readByte(address: number, index: number): number;
  writeEnd?(): void;
}

/**
 * The completion calls and callbacks `RPI2C` exposes.
 *
 * Declared structurally rather than as `RPI2C` so the bridge can be driven
 * without a machine, exactly as `TwiCompleter` lets the AVR bridge be tested.
 */
export interface Rp2040I2cPeripheral {
  onStart: (repeatedStart: boolean) => void;
  onConnect: (address: number, mode: I2CMode) => void;
  onWriteByte: (value: number) => void;
  onReadByte: (ack: boolean) => void;
  onStop: () => void;
  completeStart(): void;
  completeConnect(ack: boolean, nackByte?: number): void;
  completeWrite(ack: boolean): void;
  completeRead(value: number): void;
  completeStop(): void;
}

/**
 * Translates one RP2040 I2C peripheral into engine I2C calls.
 *
 * The DW_apb_i2c block asks its callback who acknowledged each phase and
 * waits for the matching completion call, so this is the same shape as the
 * AVR TWI bridge: a write connect is ACKed optimistically, each byte reports
 * whether a device claimed it, and a read is fetched a byte at a time. An
 * absent device answers 0xFF rather than hanging the firmware.
 *
 * Pin muxing is not consulted: the board model declares which nets carry the
 * bus, and the engine already decides whether a device is on them. Moving the
 * peripheral to other pins in firmware therefore still reaches the devices on
 * the board's default pair -- the same limit the interpreter's `machine.I2C`
 * has, and what keeps the bench one bus.
 */
export function attachRp2040I2cBridge(
  peripheral: Rp2040I2cPeripheral,
  sink: Rp2040I2cSink,
): void {
  let address = 0;
  let writeBytes: number[] = [];
  let readIndex = 0;
  let lastWriteClaimed: boolean | null = null;
  /** True while the open phase is a write (set by connect, cleared by stop). */
  let writePhase = false;

  peripheral.onStart = () => {
    peripheral.completeStart();
  };

  peripheral.onConnect = (target, mode) => {
    address = target & 0x7f;
    if (mode === I2CMode.Write) {
      writeBytes = [];
      writePhase = true;
      peripheral.completeConnect(true);
      return;
    }
    readIndex = 0;
    writePhase = false;
    // A read after a register write uses that write's acknowledgement; a
    // bare read has nothing to go on and ACKs so a missing device answers
    // 0xFF instead of wedging the transfer.
    peripheral.completeConnect(lastWriteClaimed ?? true);
  };

  peripheral.onWriteByte = (value) => {
    const byte = value & 0xff;
    const claimed = sink.writeByte(address, byte, writeBytes.length === 0);
    writeBytes.push(byte);
    lastWriteClaimed = claimed;
    peripheral.completeWrite(claimed);
  };

  peripheral.onReadByte = () => {
    const value = sink.readByte(address, readIndex);
    readIndex += 1;
    peripheral.completeRead(value & 0xff);
  };

  peripheral.onStop = () => {
    // A read or an empty stop has no staged bytes to report; only a write
    // phase closes a transfer the bus monitor should see.
    if (writePhase) sink.writeEnd?.();
    peripheral.completeStop();
    writeBytes = [];
    readIndex = 0;
    lastWriteClaimed = null;
    writePhase = false;
  };
}
