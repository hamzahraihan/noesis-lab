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
} from '@/features/parts';

export type BoardId = 'esp32' | 'uno' | 'mega' | 'nano' | 'rp2040' | 'franzininho' | 'raspberry-pi';

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

/**
 * How the starter bench is wired onto each board.
 *
 * Every board here is wire-compatible with the Arduino pin numbers the sketch
 * talks in, so the starter circuit is the same circuit -- what differs is which
 * header pin carries it and which two carry I2C.
 */
export interface StarterWiring {
  /**
   * The pin number the board's own starter sketch drives.
   *
   * Every microcontroller here answers to pin 2, which is why a single
   * constant used to do. A single-board computer does not: its GPIO2 is the
   * I2C data line, and putting the starter LED there would short the display's
   * SDA to the LED. Stating the pin per board means the LED lands where that
   * board's sketch says it does, and a test can check the two still agree.
   */
  readonly ledPin: number;
  /**
   * Header pin carrying the starter LED.
   *
   * It must be the hole whose firmware pin number is `ledPin`. A board wired to
   * a different number builds a bench whose LED is dead, which reads as a
   * broken simulator rather than a wiring mistake, and it is the kind of fault
   * that hides because only the board it was written for ever worked.
   */
  readonly led: string;
  /** Any pin of the board's ground plane. */
  readonly ground: string;
  /** SDA then SCL. */
  readonly i2c: readonly [string, string];
  /** Chip-select, D/C, clock and MOSI, in that order. */
  readonly spi: readonly [string, string, string, string];
}

export const STARTER_WIRING: Readonly<Record<BoardId, StarterWiring>> = {
  esp32: {
    ledPin: 2,
    led: 'R_D2',
    ground: 'L_GND',
    i2c: ['R_D21', 'R_D22'],
    spi: ['R_D5', 'R_D15', 'R_D18', 'R_D23'],
  },
  uno: {
    ledPin: 2,
    led: 'J1_D2',
    ground: 'J1_GND',
    i2c: ['J3_A4', 'J3_A5'],
    spi: ['J1_D10', 'J1_D9', 'J1_D13', 'J1_D11'],
  },
  /*
   * The Mega's SPI is the 50-53 block its own peripheral sits on, not the
   * 10-13 an Uno sketch names, and its SDA and SCL holes are shadowed by the
   * numbered 20 and 21 beside them -- so the bus is wired to the numbered
   * pair, which is what a pin number resolves to.
   */
  mega: {
    ledPin: 2,
    led: 'J1_2',
    ground: 'J3_GND2',
    i2c: ['J1_20', 'J1_21'],
    spi: ['J2b_53', 'J1_9', 'J2a_52', 'J2b_51'],
  },
  nano: {
    ledPin: 2,
    led: 'J1_2',
    ground: 'J1_GND',
    i2c: ['J3_A4', 'J3_A5'],
    spi: ['J1_10', 'J1_9', 'J2_13', 'J1_11'],
  },
  /*
   * The RP2040's analog block silkscreens A0-A3 on the GPIO its ADC samples,
   * so that is what the I2C pair is wired to. A4 and A5 name those same two
   * holes as their I2C aliases but carry no pin number of their own.
   */
  rp2040: {
    ledPin: 2,
    led: 'J1_D2',
    ground: 'J1_GND',
    i2c: ['J3_A0', 'J3_A1'],
    spi: ['J1_D10', 'J1_D9', 'J2_D13', 'J1_D11'],
  },
  /*
   * GPIO17 for the LED rather than GPIO2, which is what every microcontroller
   * here uses: on a Pi that pin is I2C SDA1 and the starter bench already has a
   * display on the bus. The buses are the Pi's own -- SPI0 on GPIO10, 9 and 11
   * with CE0 on GPIO8 -- and the spare GPIO24 beside them is the data/command
   * line the displays wired to this board expect.
   */
  'raspberry-pi': {
    ledPin: 17,
    led: 'J8_11',
    ground: 'J8_9',
    i2c: ['J8_3', 'J8_5'],
    spi: ['J8_24', 'J8_18', 'J8_23', 'J8_19'],
  },
  /*
   * The Franzininho is an ATtiny85 on a small carrier with no digital header of
   * its own, so its buses sit on the port bits: PB2/PB3 are the USI's I2C,
   * which is the pair the chip's own pins 2 and 3 already are. Pin 2 is PB2, so
   * the starter LED shares the SDA hole -- the one board here where a sketch
   * cannot own pin 2 for itself.
   */
  franzininho: {
    ledPin: 2,
    led: 'J1_PB2',
    ground: 'J1_GND.1',
    i2c: ['J1_PB2', 'J1_PB3'],
    spi: ['J1_PB0', 'J1_PB5', 'J1_PB4', 'J1_PB3'],
  },
};
