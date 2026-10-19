/**
 * The board registry: which boards the bench can be built around, and how each
 * one's buses and starter LED land on its headers.
 *
 * This lives apart from any component because two of them need it -- the home
 * page that offers the choice and the bench that is built from it -- and a
 * second list would be a second answer to "which boards are there".
 *
 * The electrical facts a card shows are *derived* from each board's definition
 * rather than typed out here, so a card cannot quote a 10-bit ADC for a board
 * the simulator models as 12-bit. Only the editorial lines are hand-written.
 */

import type { PartDefinition } from '@/features/parts';
import type { FirmwareLanguage } from '@/features/simulation';
import {
  arduinoMega2560,
  arduinoNano,
  arduinoUnoR3,
  esp32DevKitV1,
  franzininhoBoard,
  nanoRp2040Connect,
  raspberryPi4,
  raspberryPiPico,
} from '@/features/parts';

export type BoardId = 'esp32' | 'uno' | 'mega' | 'nano' | 'rp2040' | 'franzininho' | 'raspberry-pi' | 'pico';

export interface BoardOption {
  readonly id: BoardId;
  readonly name: string;
  readonly make: () => PartDefinition;
  /**
   * The grammar a sketch for this board is written in.
   *
   * Every board here so far takes a sketch. A single-board computer does not
   * -- it runs Linux, and its pins have no ADC and no sketch entry points --
   * so which language a bench opens in is a property of the board rather than
   * a setting the operator has to notice.
   */
  readonly language: FirmwareLanguage;
  readonly summary: string;
  /** Who should reach for it, and what it makes harder. */
  readonly bestFor: string;
}

/**
 * The boards on offer, in the order they are presented.
 *
 * A list rather than two entries so a swap is a choice rather than a coin toss,
 * and so adding a board is one line here rather than a new branch in every place
 * that has to know which board it is looking at.
 *
 * The Uno leads because it is the baseline the written curriculum assumes: every
 * exercise in `docs/exercises` is written against 5 V logic and a 10-bit ADC.
 */
export const BOARDS: ReadonlyArray<BoardOption> = [
  {
    id: 'uno',
    name: 'Arduino Uno R3',
    make: arduinoUnoR3,
    language: 'arduino-cpp',
    summary: 'The classic beginner board, and the one the exercises are written for.',
    bestFor:
      'Starting out. 5 V logic and a 10-bit ADC mean the numbers in the lessons match what you measure. Only D2 and D3 take interrupts, which is a lesson in itself.',
  },
  {
    id: 'esp32',
    name: 'ESP32 DevKit V1',
    make: esp32DevKitV1,
    language: 'arduino-cpp',
    summary: '3.3 V, 12-bit ADC, and four pins that cannot drive anything.',
    bestFor:
      'Later, once 5 V is comfortable. GPIO34-39 are input-only, and GPIO12 and GPIO15 are sampled at reset -- both traps the bench reproduces so you can hit them.',
  },
  {
    id: 'nano',
    name: 'Arduino Nano',
    make: arduinoNano,
    language: 'arduino-cpp',
    summary: 'The same chip as the Uno on a much smaller board.',
    bestFor:
      'When the Uno is too big for the breadboard. Same 5 V and same 10-bit ADC, so every lesson transfers unchanged.',
  },
  {
    id: 'rp2040',
    name: 'Nano RP2040 Connect',
    make: nanoRp2040Connect,
    language: 'python',
    summary: '3.3 V logic with a 12-bit ADC on a Nano-sized board.',
    bestFor:
      'Modern practice. The analogue block silkscreens A0-A3 on the pins its ADC samples, which surprises anyone coming from an AVR.',
  },
  {
    id: 'mega',
    name: 'Arduino Mega 2560',
    make: arduinoMega2560,
    language: 'arduino-cpp',
    summary: 'Every Uno extra, in numbers: the most pins of any board here.',
    bestFor:
      'Bigger builds. Its SPI is the 50-53 block rather than the 10-13 an Uno sketch names, so a sketch written for one does not transfer by pin number.',
  },
  {
    id: 'raspberry-pi',
    name: 'Raspberry Pi 4',
    make: raspberryPi4,
    // A single-board computer runs Linux, not a sketch. This is the one board
    // here whose firmware is Python, and the bench opens in that language so
    // the first thing it runs is something the board could actually run.
    language: 'python',
    summary: 'A Linux computer you wire directly, with no analogue input at all.',
    bestFor:
      'Learning what a pin cannot do. The GPIO is 3.3 V and not 5 V tolerant, the outputs drive a fraction of what an Uno does, there is no analogue input without an MCP3008, and the pins are numbered BCM rather than by position.',
  },
  {
    id: 'franzininho',
    name: 'Franzininho',
    make: franzininhoBoard,
    language: 'arduino-cpp',
    summary: 'An ATtiny85 on a small carrier: six I/O pins and no digital header.',
    bestFor:
      'Understanding the limits. Two general GPIO and four analogue pins is not many, the buses sit on the port bits rather than a digital header, and the silkscreen disagrees with the firmware numbers -- PB5 is pin 4 and PB4 is pin 5. Pin 2 is also its SDA, so a sketch cannot own it outright.',
  },
  {
    id: 'pico',
    name: 'Raspberry Pi Pico',
    make: raspberryPiPico,
    language: 'python',
    summary: 'A small RP2040 board with 26 GPIO pins and no analogue input beyond three ADC channels.',
    bestFor:
      'Modern embedded Python on a cheap board. Same RP2040 as the Nano RP2040 Connect, so the MicroPython backend transfers; the header is a 2x20 DIP block rather than a Nano footprint.',
  },
];

/** The board a first-time learner should start on. */
export const DEFAULT_BOARD_ID: BoardId = 'uno';

/**
 * Whether a string from the URL names a board this app builds.
 *
 * A route parameter is a string, and it can be anything a hand-edited or stale
 * link put there. This is the check that keeps an unknown id from reaching the
 * bench build, where `boardOption` would throw inside a render and take the
 * whole page down with it.
 */
export function isBoardId(value: string | undefined): value is BoardId {
  return BOARDS.some((board) => board.id === value);
}

/**
 * Finds a board, or throws naming it.
 *
 * The throw is the behaviour: a board id is a string that arrived from a URL or
 * a stale saved choice, and a silent fallback would build the wrong bench with
 * no explanation.
 */
export function boardOption(boardId: BoardId): BoardOption {
  const board = BOARDS.find((candidate) => candidate.id === boardId);
  if (!board) throw new Error(`unknown board ${boardId}`);
  return board;
}

/** What a board card shows, read off the definition rather than typed out. */
export interface BoardSpecs {
  readonly logicVolts: number;
  readonly adcBits: number;
  readonly pwmHz: number;
  readonly sinkOhms: number;
  readonly sourceOhms: number;
  /** Pins firmware can address by number. */
  readonly gpioCount: number;
  readonly adcCount: number;
  /** Pins with no output driver, which cannot run a sketch's LEDs. */
  readonly inputOnlyCount: number;
}

/**
 * Counts and electrical limits, derived from the board's own pin table.
 *
 * Reading these off the definition is the point: a board modelled as 12-bit
 * cannot be described as 10-bit without the description and the simulation
 * disagreeing, and the learner would find out which one was lying by measuring.
 */
export function boardSpecs(boardId: BoardId): BoardSpecs {
  const definition = boardOption(boardId).make();
  if (definition.component.kind !== 'mcu') {
    throw new Error(`${definition.name} is not a microcontroller board`);
  }
  const { board } = definition.component;
  const pins = definition.boardPins ?? [];

  return {
    logicVolts: board.logicVolts,
    adcBits: board.adcBits,
    pwmHz: board.pwmHz,
    sinkOhms: board.sinkOhms,
    sourceOhms: board.sourceOhms,
    gpioCount: pins.filter((pin) => pin.role === 'gpio').length,
    adcCount: pins.filter((pin) => pin.role === 'adc').length,
    inputOnlyCount: pins.filter((pin) => pin.canDrive === false).length,
  };
}
