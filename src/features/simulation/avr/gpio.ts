import { CPU, AVRIOPort, portBConfig, portCConfig, portDConfig } from 'avr8js';
import { McuRuntime, type PinDirection } from '@/features/simulation/mcu';
import { UNO_GPIO_MAP } from './backend';

const PORTS = { B: portBConfig, C: portCConfig, D: portDConfig } as const;

/** Pushes AVR DDR/PORT state into McuRuntime intent on every change. */
export function attachGpioBridge(cpu: CPU, mcu: McuRuntime, nowMs: () => number, readPin: (gpio: number) => boolean, onEdge?: (gpio: number, cycles: number) => void): void {
  const ports = {
    B: new AVRIOPort(cpu, PORTS.B),
    C: new AVRIOPort(cpu, PORTS.C),
    D: new AVRIOPort(cpu, PORTS.D),
  };
  /** Last driven level per gpio; baselined on first sight, never an edge. */
  const drivenHigh = new Map<number, boolean>();
  const sync = (): void => {
    for (const entry of UNO_GPIO_MAP) {
      const ddr = (cpu.data[portDataAddr(entry.port, 'ddr')] >> entry.bit) & 1;
      const port = (cpu.data[portDataAddr(entry.port, 'port')] >> entry.bit) & 1;
      const direction: PinDirection = ddr === 1 ? 'output' : port === 1 ? 'inputPullUp' : 'input';
      mcu.setDirection(entry.gpio, direction);
      if (direction === 'output') {
        const high = port === 1;
        mcu.writeDigital(entry.gpio, high, nowMs());
        // Cycle-stamped transitions on driven pins only: the servo pump turns
        // these into pulse widths, so inputs and direction changes baseline
        // without reporting.
        const prev = drivenHigh.get(entry.gpio);
        if (prev !== undefined && prev !== high) onEdge?.(entry.gpio, cpu.cycles);
        drivenHigh.set(entry.gpio, high);
      } else {
        drivenHigh.delete(entry.gpio);
      }
    }
  };
  for (const port of Object.values(ports)) port.addListener(() => sync());
  sync();
  const pinAddr = { B: 35, C: 38, D: 41 } as const;
  for (const [port, addr] of Object.entries(pinAddr) as Array<['B' | 'C' | 'D', number]>) {
    cpu.readHooks[addr] = () => {
      let byte = 0;
      for (const entry of UNO_GPIO_MAP) {
        if (entry.port === port && readPin(entry.gpio)) byte |= 1 << entry.bit;
      }
      return byte;
    };
  }
}

function portDataAddr(port: 'B' | 'C' | 'D', reg: 'ddr' | 'port'): number {
  // AVR data addresses (decimal): DDRB 36, PORTB 37, DDRC 39, PORTC 40, DDRD 42, PORTD 43.
  if (port === 'B') return reg === 'ddr' ? 36 : 37;
  if (port === 'C') return reg === 'ddr' ? 39 : 40;
  return reg === 'ddr' ? 42 : 43;
}
