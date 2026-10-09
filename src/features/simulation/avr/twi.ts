import { AVRTWI, twiConfig, type CPU, type TWIEventHandler } from 'avr8js';
import { UNO_CLOCK_HZ } from './backend';

/** Structural subset of AVRTWI the bridge drives; AVRTWI satisfies it directly. */
export interface TwiCompleter {
  completeStart(): void;
  completeStop(): void;
  completeConnect(ack: boolean): void;
  completeWrite(ack: boolean): void;
  completeRead(value: number): void;
}

export interface TwiSink {
  writeByte(address: number, byte: number, isFirst: boolean): boolean;
  readByte(address: number, index: number): number;
  /**
   * Closes a write phase (STOP after a write connect). Optional so
   * engine-direct sinks that do their own logging can skip it; reads and
   * empty stops never trigger it.
   */
  writeEnd?(): void;
}

/**
 * Translates TWI peripheral events into engine I2C calls.
 *
 * Reads are fetched per byte (`readByte(addr, index)`); the Ds1307 model is
 * idempotent across `read()`, so byte i is always fresh without staging.
 * A read connect with no preceding write defaults to ACK; an absent device
 * then answers 0xFF per byte via the sink — never a hang.
 */
export class TwiBridgeHandler implements TWIEventHandler {
  private readonly completer: TwiCompleter;
  private readonly sink: TwiSink;
  private writeBuffer: number[] = [];
  private readIndex = 0;
  private address = 0;
  private lastWriteClaimed: boolean | null = null;
  /** True while the open phase is a write (set by connect, cleared by stop). */
  private writePhase = false;

  constructor(completer: TwiCompleter, sink: TwiSink) {
    this.completer = completer;
    this.sink = sink;
  }

  start(_repeated: boolean): void {
    this.completer.completeStart();
  }

  stop(): void {
    // Flush the closing phase only when it was a write: a read or an
    // empty stop has no staged bytes to report.
    if (this.writePhase) this.sink.writeEnd?.();
    this.completer.completeStop();
    this.writeBuffer = [];
    this.readIndex = 0;
    this.lastWriteClaimed = null;
    this.writePhase = false;
  }

  connectToSlave(addr: number, write: boolean): void {
    this.address = addr & 0x7f;
    if (write) {
      this.writeBuffer = [];
      this.writePhase = true;
      this.completer.completeConnect(true);
      return;
    }
    this.readIndex = 0;
    this.writePhase = false;
    this.completer.completeConnect(this.lastWriteClaimed ?? true);
  }

  writeByte(value: number): void {
    const claimed = this.sink.writeByte(this.address, value & 0xff, this.writeBuffer.length === 0);
    this.writeBuffer.push(value & 0xff);
    this.lastWriteClaimed = claimed;
    this.completer.completeWrite(claimed);
  }

  readByte(_ack: boolean): void {
    const value = this.sink.readByte(this.address, this.readIndex);
    this.readIndex += 1;
    this.completer.completeRead(value & 0xff);
  }
}

/** Attaches the TWI peripheral with the handler bound to itself. */
export function attachTwiBridge(cpu: CPU, sink: TwiSink): void {
  const twi = new AVRTWI(cpu, twiConfig, UNO_CLOCK_HZ);
  twi.eventHandler = new TwiBridgeHandler(twi, sink);
}
