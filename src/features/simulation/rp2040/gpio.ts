import { GPIOPinState, type RP2040 } from 'rp2040js';
import type { Rp2040Hooks } from './backend';

/**
 * Pushes RP2040 pin state into McuRuntime intent on every change, mirroring
 * avr/gpio.ts: driven levels report cycle-stamped transitions; inputs and
 * direction changes baseline without reporting. Firmware reads reach the
 * engine through setInputValue, pushed after each settle.
 */
export function attachRp2040GpioBridge(
  rp2040: RP2040,
  hooks: Pick<Rp2040Hooks, 'mcu' | 'nowMs' | 'onEdge'>,
): void {
  const driven = new Map<number, boolean>();
  for (const pin of rp2040.gpio) {
    const gpio = pin.index;
    pin.addListener((state) => {
      if (state === GPIOPinState.High || state === GPIOPinState.Low) {
        const high = state === GPIOPinState.High;
        hooks.mcu.setDirection(gpio, 'output');
        hooks.mcu.writeDigital(gpio, high, hooks.nowMs());
        const prev = driven.get(gpio);
        if (prev !== undefined && prev !== high) hooks.onEdge?.(gpio, rp2040.core.cycles, high);
        driven.set(gpio, high);
      } else {
        hooks.mcu.setDirection(gpio, state === GPIOPinState.InputPullUp ? 'inputPullUp' : 'input');
        driven.delete(gpio);
      }
    });
  }
}
