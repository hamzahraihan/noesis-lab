import { CPU, AVRIOPort, portBConfig, portCConfig, portDConfig } from 'avr8js';
import { McuRuntime, type PinDirection } from '@/features/simulation/mcu';
import { UNO_GPIO_MAP } from './backend';

const PORTS = { B: portBConfig, C: portCConfig, D: portDConfig } as const;

/** Pushes AVR DDR/PORT state into McuRuntime intent on every change. */
export function attachGpioBridge(cpu: CPU, mcu: McuRuntime, nowMs: () => number): void {
  const ports = {
    B: new AVRIOPort(cpu, PORTS.B),
    C: new AVRIOPort(cpu, PORTS.C),
    D: new AVRIOPort(cpu, PORTS.D),
  };
  const sync = (): void => {
    for (const entry of UNO_GPIO_MAP) {
      const ddr = (cpu.data[portDataAddr(entry.port, 'ddr')] >> entry.bit) & 1;
      const port = (cpu.data[portDataAddr(entry.port, 'port')] >> entry.bit) & 1;
      const direction: PinDirection = ddr === 1 ? 'output' : port === 1 ? 'inputPullUp' : 'input';
      mcu.setDirection(entry.gpio, direction);
      if (direction === 'output') mcu.writeDigital(entry.gpio, port === 1, nowMs());
    }
  };
  for (const port of Object.values(ports)) port.addListener(() => sync());
  sync();
}

function portDataAddr(port: 'B' | 'C' | 'D', reg: 'ddr' | 'port'): number {
  // AVR data addresses (decimal): DDRB 36, PORTB 37, DDRC 39, PORTC 40, DDRD 42, PORTD 43.
  if (port === 'B') return reg === 'ddr' ? 36 : 37;
  if (port === 'C') return reg === 'ddr' ? 39 : 40;
  return reg === 'ddr' ? 42 : 43;
}
