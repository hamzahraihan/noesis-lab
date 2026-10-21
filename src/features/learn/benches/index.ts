/**
 * Bench presets as documents.
 *
 * Two kinds, one shape: `starter-<board>` is the bench a board opens with
 * (LED, OLED, TFT and the wires that make them work); `example-<id>-<board>`
 * is the bench one of the `examples.ts` sketches assumes. Every one is a
 * complete circuit naming its own board, so it goes through the same
 * `parseCircuit` gate, `compile` and board check as a curriculum circuit --
 * there is no second representation to drift.
 *
 * An example is offered on a board only when it has a circuit and a sketch for
 * that board's firmware: the C++ examples cover the Arduino boards, and the
 * MicroPython ports cover the Pico and the Nano RP2040 Connect.
 */

import type { CircuitDocument } from '@/features/simulation';
import { parseCircuit } from '@/features/simulation';
import type { BoardId } from '../boardRegistry';

import starterEsp32 from './starter-esp32.json';
import starterAttiny85 from './starter-attiny85.json';
import starterFranzininho from './starter-franzininho.json';
import starterMega from './starter-mega.json';
import starterNano from './starter-nano.json';
import starterRaspberryPi from './starter-raspberry-pi.json';
import starterPico from './starter-pico.json';
import starterRp2040 from './starter-rp2040.json';
import starterUno from './starter-uno.json';

import exampleBlinkEsp32 from './example-blink-esp32.json';
import exampleBlinkFranzininho from './example-blink-franzininho.json';
import exampleBlinkMega from './example-blink-mega.json';
import exampleBlinkNano from './example-blink-nano.json';
import exampleBlinkUno from './example-blink-uno.json';
import exampleCharacterLcdEsp32 from './example-character-lcd-esp32.json';
import exampleCharacterLcdFranzininho from './example-character-lcd-franzininho.json';
import exampleCharacterLcdMega from './example-character-lcd-mega.json';
import exampleCharacterLcdNano from './example-character-lcd-nano.json';
import exampleCharacterLcdUno from './example-character-lcd-uno.json';
import exampleI2cClockEsp32 from './example-i2c-clock-esp32.json';
import exampleI2cClockFranzininho from './example-i2c-clock-franzininho.json';
import exampleI2cClockMega from './example-i2c-clock-mega.json';
import exampleI2cClockNano from './example-i2c-clock-nano.json';
import exampleI2cClockPico from './example-i2c-clock-pico.json';
import exampleI2cClockRp2040 from './example-i2c-clock-rp2040.json';
import exampleI2cClockUno from './example-i2c-clock-uno.json';
import examplePotentiometerPico from './example-potentiometer-pico.json';
import examplePotentiometerRp2040 from './example-potentiometer-rp2040.json';
import exampleServoEsp32 from './example-servo-esp32.json';
import exampleServoFranzininho from './example-servo-franzininho.json';
import exampleServoMega from './example-servo-mega.json';
import exampleServoNano from './example-servo-nano.json';
import exampleServoUno from './example-servo-uno.json';

/** The bench each board opens with, as a document. */
export const STARTER_CIRCUITS: Readonly<Record<BoardId, CircuitDocument>> = {
  uno: parseCircuit(starterUno, 'starter-uno'),
  esp32: parseCircuit(starterEsp32, 'starter-esp32'),
  nano: parseCircuit(starterNano, 'starter-nano'),
  mega: parseCircuit(starterMega, 'starter-mega'),
  rp2040: parseCircuit(starterRp2040, 'starter-rp2040'),
  franzininho: parseCircuit(starterFranzininho, 'starter-franzininho'),
  'raspberry-pi': parseCircuit(starterRaspberryPi, 'starter-raspberry-pi'),
  pico: parseCircuit(starterPico, 'starter-pico'),
  attiny85: parseCircuit(starterAttiny85, 'starter-attiny85'),
};

/** The bench each example sketch assumes, per board. */
export const EXAMPLE_CIRCUITS: Readonly<Record<string, Partial<Record<BoardId, CircuitDocument>>>> =
  {
    blink: {
      uno: parseCircuit(exampleBlinkUno, 'example-blink-uno'),
      esp32: parseCircuit(exampleBlinkEsp32, 'example-blink-esp32'),
      nano: parseCircuit(exampleBlinkNano, 'example-blink-nano'),
      mega: parseCircuit(exampleBlinkMega, 'example-blink-mega'),
      franzininho: parseCircuit(exampleBlinkFranzininho, 'example-blink-franzininho'),
    },
    'i2c-clock': {
      uno: parseCircuit(exampleI2cClockUno, 'example-i2c-clock-uno'),
      esp32: parseCircuit(exampleI2cClockEsp32, 'example-i2c-clock-esp32'),
      nano: parseCircuit(exampleI2cClockNano, 'example-i2c-clock-nano'),
      mega: parseCircuit(exampleI2cClockMega, 'example-i2c-clock-mega'),
      franzininho: parseCircuit(exampleI2cClockFranzininho, 'example-i2c-clock-franzininho'),
      /*
       * The MicroPython ports of the same clock. The Pico's I2C0 comes out on
       * GP0 and GP1, so the data wires land on the first two pins of the left
       * header -- the Pico has no dedicated SDA/SCL holes. The Nano RP2040
       * Connect brings the same peripheral out on A4 and A5.
       */
      pico: parseCircuit(exampleI2cClockPico, 'example-i2c-clock-pico'),
      rp2040: parseCircuit(exampleI2cClockRp2040, 'example-i2c-clock-rp2040'),
    },
    potentiometer: {
      /*
       * The two boards whose firmware can read a divider directly: the analog
       * block behind A0 is wired to the header on both, where an Uno's A0 is
       * pushed through the Wi-Fi module and the Pi has no converter at all.
       */
      pico: parseCircuit(examplePotentiometerPico, 'example-potentiometer-pico'),
      rp2040: parseCircuit(examplePotentiometerRp2040, 'example-potentiometer-rp2040'),
    },
    'character-lcd': {
      uno: parseCircuit(exampleCharacterLcdUno, 'example-character-lcd-uno'),
      esp32: parseCircuit(exampleCharacterLcdEsp32, 'example-character-lcd-esp32'),
      nano: parseCircuit(exampleCharacterLcdNano, 'example-character-lcd-nano'),
      mega: parseCircuit(exampleCharacterLcdMega, 'example-character-lcd-mega'),
      franzininho: parseCircuit(
        exampleCharacterLcdFranzininho,
        'example-character-lcd-franzininho',
      ),
    },
    servo: {
      uno: parseCircuit(exampleServoUno, 'example-servo-uno'),
      esp32: parseCircuit(exampleServoEsp32, 'example-servo-esp32'),
      nano: parseCircuit(exampleServoNano, 'example-servo-nano'),
      mega: parseCircuit(exampleServoMega, 'example-servo-mega'),
      franzininho: parseCircuit(exampleServoFranzininho, 'example-servo-franzininho'),
    },
  };

/** The document an example needs for a board, or null where it has none. */
export function exampleCircuitFor(exampleId: string, boardId: BoardId): CircuitDocument | null {
  return EXAMPLE_CIRCUITS[exampleId]?.[boardId] ?? null;
}

/** The bench a board opens with. Every board has one. */
export function starterCircuitFor(boardId: BoardId): CircuitDocument {
  return STARTER_CIRCUITS[boardId];
}
