/**
 * The featured project for each board: a curated showcase, not a new build.
 *
 * The bench already opens with every board's starter project wired (a
 * blinking LED, an SSD1306 OLED on I2C, an ILI9341 TFT on SPI) and its
 * sketch loaded, so these entries describe that project in per-board words
 * rather than inventing new ones. `tryNext` names bench examples by their
 * EXAMPLES id; the Python boards name none, because those examples are C++
 * sketches and their benches speak (Micro)Python.
 */

import type { BoardId } from './boardRegistry';

export interface BoardProject {
  readonly board: BoardId;
  /** The project, in a few words: what is wired and loaded. */
  readonly project: string;
  /** One line under the board name. */
  readonly tagline: string;
  /** Why this board for this project — the per-board angle. */
  readonly why: string;
  /** What pressing Run shows, as a checklist. */
  readonly youWillSee: readonly string[];
  /** Bench example ids worth trying next, in EXAMPLES words. */
  readonly tryNext: readonly string[];
}

const STARTER_SEEN = [
  'The on-bench LED blinks steadily',
  'A bar sweeps each display, both buses driven by hand',
  'The serial monitor counts along: blink 1, blink 2, …',
] as const;

export const PROJECTS: readonly BoardProject[] = [
  {
    board: 'uno',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'The classic first bench — one blinking LED and two hand-driven displays.',
    why: 'The baseline the lessons assume: 5 V logic and a 10-bit ADC, so every number in the curriculum measures what it says.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'esp32',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'The same starter bench at 3.3 V — plus the pins that bite.',
    why: '3.3 V logic, a 12-bit ADC, input-only GPIO34–39, and reset-strapping pins the bench reproduces so you can hit them safely.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'nano',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: "The Uno's chip on a breadboard-friendly board.",
    why: 'Same ATmega, same 5 V, same 10-bit ADC — every lesson transfers unchanged, and the narrow board leaves room on the breadboard.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'rp2040',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'Modern 3.3 V practice with a 12-bit ADC.',
    why: '3.3 V logic and 12-bit conversion on a Nano-sized board. The analogue block silkscreens A0–A3 on the pins its ADC samples, which surprises anyone coming from an AVR.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['potentiometer', 'i2c-clock'],
  },
  {
    board: 'mega',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'Room to grow: the most pins of any board here.',
    why: "Bigger builds. Its SPI lives on pins 50–53 rather than the Uno's 10–13, so a sketch written for one does not transfer by pin number.",
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'raspberry-pi',
    project: 'Python blink on GPIO17',
    tagline: 'A Linux computer you wire directly — in Python, not C++.',
    why: '3.3 V GPIO that is not 5 V tolerant, no analogue input without an MCP3008, and BCM numbering. The bench opens in Python because that is what this board speaks.',
    youWillSee: [
      'The LED on GPIO17 blinks on and off twice a second',
      'The wired OLED and TFT stay dark — this sketch drives no bus',
    ],
    tryNext: [],
  },
  {
    board: 'pico',
    project: 'MicroPython blink on GP2',
    tagline: 'The RP2040 in its own 40-pin shape, driven from MicroPython.',
    why: 'The same chip as the Nano RP2040 Connect, in the Pico footprint: 26 GPIO across two headers, 12-bit conversion on three ADC channels (GP26–28), and 3.3 V logic. The bench opens in MicroPython here, and the clock and divider examples ship MicroPython ports, so the examples are open to this board too.',
    youWillSee: [
      'The serial prints "pico online" once, then the loop runs',
      'The LED on GP2 blinks on and off twice a second',
    ],
    tryNext: ['i2c-clock', 'potentiometer'],
  },
  {
    board: 'franzininho',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'An ATtiny85 on a carrier: six I/O pins and hard limits.',
    why: 'Two general GPIO and four analogue pins, buses on the port bits, and a silkscreen that disagrees with the firmware numbers — PB5 is pin 4 and PB4 is pin 5. Pin 2 shares SDA, so no sketch owns it outright.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink'],
  },
];

export function projectFor(boardId: BoardId): BoardProject | null {
  return PROJECTS.find((entry) => entry.board === boardId) ?? null;
}
