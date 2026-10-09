import { AVRUSART, usart0Config, type CPU } from 'avr8js';
import { UNO_CLOCK_HZ } from './backend';

export interface UsartSink {
  serialWrite(text: string): void;
}

/**
 * Forwards USART0 transmitted bytes to the shared serial sink.
 *
 * RX is out of scope for milestone one: without a sender the hardware flags
 * frame errors, and the bridge invents nothing.
 */
export function attachUsartBridge(cpu: CPU, sink: UsartSink): void {
  const usart = new AVRUSART(cpu, usart0Config, UNO_CLOCK_HZ);
  usart.onByteTransmit = (value) => {
    sink.serialWrite(String.fromCharCode(value & 0xff));
  };
}
