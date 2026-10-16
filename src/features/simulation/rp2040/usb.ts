import { USBCDC, type RP2040 } from 'rp2040js';

const INTR_DEV_SOF = 1 << 17;
const SOF_RD_OFFSET = 0x48;
const SOF_PERIOD_NANOS = 1_000_000;

/** The USB register fields rp2040js keeps private but the engine must drive. */
interface UsbInternals {
  intRaw: number;
  sofFrameNumber: number;
  checkInterrupts(): void;
}

export interface Rp2040SerialSink {
  serialWrite(text: string): void;
}

/**
 * Serial bridge: MicroPython's print/REPL ride USB CDC; machine.UART(0)
 * writes ride UARTDR (onByte). Both land in the same monitor sink.
 *
 * Also hosts the device-SOF emulation. rp2040js never raises the device SOF
 * interrupt, but MicroPython v1.29 flushes CDC output buffered before USB was
 * ready only on the next print or ~16 SOFs after DTR — so a single early
 * print followed by silence is stuck forever (recon: smoke5). We deliver one
 * SOF per simulated millisecond, exactly like the host does, and retire the
 * raw interrupt when the firmware reads SOF_RD — the real hardware's own
 * acknowledge (dcd_rp2040.c: "clear interrupt by reading SOF_RD"), which
 * rp2040js also does not model (recon: smoke7).
 */
export class Rp2040Serial {
  private readonly clock: { readonly nanos: number };
  private readonly internals: UsbInternals;
  private readonly decoder = new TextDecoder();
  private nextSofNanos = SOF_PERIOD_NANOS;

  constructor(rp2040: RP2040, clock: { readonly nanos: number }, sink: Rp2040SerialSink) {
    this.clock = clock;
    this.internals = rp2040.usbCtrl as unknown as UsbInternals;
    const cdc = new USBCDC(rp2040.usbCtrl);
    cdc.onSerialData = (buffer) => sink.serialWrite(this.decoder.decode(buffer, { stream: true }));
    rp2040.uart[0].onByte = (byte) => sink.serialWrite(String.fromCharCode(byte));
    // SOF_RD is write-queued in hardware; reading it is the firmware's ack.
    const originalRead = rp2040.usbCtrl.readUint32.bind(rp2040.usbCtrl);
    rp2040.usbCtrl.readUint32 = (offset: number): number => {
      if (offset === SOF_RD_OFFSET) this.acknowledgeSof();
      return originalRead(offset);
    };
  }

  /** Delivers one device SOF per elapsed simulated millisecond. */
  poll(): void {
    const { nanos } = this.clock;
    if (nanos < this.nextSofNanos) return;
    this.nextSofNanos = nanos + SOF_PERIOD_NANOS;
    this.internals.sofFrameNumber = (this.internals.sofFrameNumber + 1) & 0x7ff;
    this.internals.intRaw |= INTR_DEV_SOF;
    this.internals.checkInterrupts();
  }

  private acknowledgeSof(): void {
    if ((this.internals.intRaw & INTR_DEV_SOF) === 0) return;
    this.internals.intRaw &= ~INTR_DEV_SOF;
    this.internals.checkInterrupts();
  }
}
