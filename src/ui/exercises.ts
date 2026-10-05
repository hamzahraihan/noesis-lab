/**
 * The exercise curriculum, as data the app can teach from.
 *
 * The prose lives in `docs/exercises/`, and this is deliberately not a copy of
 * it. A worksheet is written to be read front to back; this is written to be
 * *worked through* -- the brief first, then wiring, then a sketch, then hints
 * the learner reveals only when they are stuck, then references. Restating
 * twenty thousand words of prose in a shape the app can render would leave two
 * documents that drift apart the moment either one is edited.
 *
 * So each entry carries what the app acts on: what you are building, what goes
 * on the bench, which sketch to run, what to try when it does not work, and
 * where to look something up. The full write-up stays in the docs for the
 * learner who wants to read rather than do.
 *
 * **Board.** Every exercise is written for the Arduino Uno R3, and says so. The
 * bench defaults to it, and the numbers in the lessons -- 5 V logic, a 10-bit
 * ADC, two interrupt pins -- are the Uno's. An exercise that quietly ran on a
 * different board would be teaching the wrong numbers.
 *
 * **Sketch dialect.** The twin sketches run on this repo's interpreter, which
 * covers a deliberately small subset of C++: `void int float double bool char
 * byte long short unsigned signed`, arrays, and `#define`. No `struct`, no
 * `enum`, no pointers, no classes, no `String`, no `uint8_t`. Every sketch here
 * is loaded through the real parser by a test, so one that reaches for
 * something the interpreter does not have fails the suite rather than the
 * learner.
 */

import type { Simulation } from './simulation';
import { EXERCISE_BOARD, PART_STEP, PART_X, PART_Y, part } from './exercises/shared';
import { MODULE_1 } from './exercises/module-1-gpio';
import { MODULE_2 } from './exercises/module-2-analog';
import { MODULE_3 } from './exercises/module-3-bus-protocols';
import { MODULE_4 } from './exercises/module-4-interrupts';

export { EXERCISE_BOARD };


/** One row of a wiring table: where a part's terminal goes, and what it meets. */
export interface ExerciseWiring {
  /** The silkscreen name on the board: `D8`, `A0`, `5V`, `GND`. */
  readonly pin: string;
  /** The catalogue part, spelled the way the catalogue spells it. */
  readonly part: string;
  /** That part's terminal, spelled the same way. */
  readonly terminal: string;
  /** What the other end of the jumper reaches. */
  readonly goesTo: string;
}

/** A nudge, given only after the learner asks for it. */
export interface ExerciseHint {
  /** The situation it is for, phrased as something they will notice. */
  readonly when: string;
  readonly answer: string;
}

/** Something worth looking up, in the sentence a beginner needs first. */
export interface ExerciseReference {
  readonly term: string;
  readonly what: string;
  /** Where to read more, where there is somewhere worth reading. */
  readonly readMore?: string;
}

export interface Exercise {
  /** Stable id, and the number the worksheet prints. */
  readonly id: string;
  readonly title: string;
  readonly level: number;
  readonly module: string;
  readonly difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  readonly minutes: string;
  /** What you are building, in two or three sentences. */
  readonly brief: string;
  /** The ideas this exercise is the first place you meet them. */
  readonly concepts: readonly string[];
  readonly parts: readonly {
    readonly name: string;
    readonly qty: number;
    readonly why: string;
  }[];
  readonly wiring: readonly ExerciseWiring[];
  /** The build order, so nobody has to work it out from the table. */
  readonly steps: readonly string[];
  /** The sketch the twin runs. Loaded by "Put it on the bench". */
  readonly sketch: string;
  /** What to try that should not work, and what it teaches. */
  readonly fault?: { readonly break_: string; readonly teaches: string };
  readonly hints: readonly ExerciseHint[];
  readonly references: readonly ExerciseReference[];
  /** The full write-up, for the learner who wants to read rather than do. */
  readonly writeUp: string;
  /** Places the parts and runs the jumpers this exercise needs. */
  readonly setup: (simulation: Simulation) => void;
}



/* ------------------------------------------------------------------ *
 * 0.1 -- Your First Circuit
 * ------------------------------------------------------------------ */

const FIRST_CIRCUIT: Exercise = {
  id: '0.1',
  title: 'Your First Circuit',
  level: 1,
  module: 'Module 0 — First Contact',
  difficulty: 'Beginner',
  minutes: '45–60 mins',
  brief:
    'Almost every piece of electronics ever built does one thing first: it tells you it is on. ' +
    'A vending machine has a light that says ready. A car has a dashboard light that says low fuel. ' +
    'None of them measure anything, and all of them are the reason anyone knows the thing is alive. ' +
    'You are building that light — the smallest useful embedded program there is.',
  concepts: [
    'A pin is a switch you operate from a program',
    'A resistor sets a current; it is not decoration',
    'HIGH is not "on" — it is a voltage: 5 V',
  ],
  parts: [
    { name: 'Red LED', qty: 1, why: 'The light itself.' },
    { name: 'Green LED', qty: 1, why: 'A second pin, so you can tell them apart.' },
    { name: 'Blue LED', qty: 1, why: 'A third. Blue runs at a higher forward voltage.' },
    { name: '220 Resistor', qty: 3, why: 'One per LED, in series. Not optional.' },
  ],
  wiring: [
    { pin: '5V', part: 'Red LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: 'D8', part: '220 Resistor', terminal: 'b', goesTo: 'Red LED cathode' },
    { pin: 'D9', part: 'Green LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: 'D9', part: '220 Resistor', terminal: 'b', goesTo: 'Green LED cathode' },
    { pin: 'D10', part: 'Blue LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: 'D10', part: '220 Resistor', terminal: 'b', goesTo: 'Blue LED cathode' },
    { pin: 'GND', part: '220 Resistor', terminal: 'a', goesTo: 'the blue − rail' },
  ],
  steps: [
    'Look at the board. The long header along the top is digital pins 0–13; the one along the bottom is power and analog.',
    'Find D8, D9 and D10 on the top header. We use those rather than 13 because pin 13 already has an LED and a resistor fitted on the board, and it would hide the lesson.',
    'Run the red + rail from the 5V pin and the blue − rail from GND. A rail runs the whole length: the red line is one big connection, not a row of them.',
    'For each LED: its long leg (the anode) goes to the red rail, its short leg (the cathode) to one leg of a 220 Ω resistor, and the other leg of that resistor to the pin.',
    'Check every LED points the same way. An LED backwards does not light, and will not tell you why.',
    'Put the sketch in the editor and press Run. One LED should light.',
  ],
  sketch: `#include <Arduino.h>

/*
 * Module 0 twin -- three LEDs on three pins.
 *
 * The pin numbers are plain globals rather than "const byte": the
 * interpreter's parser rejects const at file scope. Inside a function
 * const is perfectly fine.
 */

byte RED   = 8;
byte GREEN = 9;
byte BLUE  = 10;

void setup() {
  // pinMode comes first, always. Until you say otherwise a pin is an input,
  // and writing HIGH to an input does nothing you can see.
  pinMode(RED, OUTPUT);
  pinMode(GREEN, OUTPUT);
  pinMode(BLUE, OUTPUT);
}

void loop() {
  digitalWrite(RED, HIGH);
  digitalWrite(GREEN, LOW);
  digitalWrite(BLUE, LOW);
  delay(400);

  digitalWrite(RED, LOW);
  digitalWrite(GREEN, HIGH);
  digitalWrite(BLUE, LOW);
  delay(400);

  digitalWrite(RED, LOW);
  digitalWrite(GREEN, LOW);
  digitalWrite(BLUE, HIGH);
  delay(400);
}
`,
  fault: {
    break_: 'Delete one of the 220 Ω resistors. That LED now has nothing limiting its current.',
    teaches:
      'Watch the meter with the resistor in and then out. The current rises to whatever the LED and ' +
      'the pin will tolerate, which is the arithmetic in the references below happening for real ' +
      'rather than being illustrated.',
  },
  hints: [
    {
      when: 'Nothing lights at all.',
      answer:
        'Work the loop one element at a time: 5V → LED anode → LED cathode → resistor → pin → GND. ' +
        'Every circuit is a loop, and one gap anywhere in it means nothing happens. Start at the ' +
        'rail: is the red + rail actually joined to the 5V pin?',
    },
    {
      when: 'One LED is dark and the other two work.',
      answer:
        'Two usual causes. Either that LED is the wrong way round — the long leg to the rail, the ' +
        'short leg to the resistor — or it is a different colour and needs a different resistor. Blue ' +
        'runs at about 3.0 V forward voltage against red\'s 1.9 V, so blue is always the dimmer one ' +
        'on the same resistor.',
    },
    {
      when: 'The LEDs are very dim, or barely there.',
      answer:
        'Check the resistor is 220 Resistor and not 10k Resistor. A 10 kΩ resistor on a 5 V LED gives ' +
        'about 0.3 mA instead of 14 mA, which in a bright room looks like nothing at all.',
    },
  ],
  references: [
    {
      term: 'Why the resistor is not optional',
      what:
        'An LED does not limit its own current. Left alone it draws whatever it can until it destroys ' +
        'itself and possibly the pin. The resistor sets the current: I = (Vsupply − Vforward) / R. At ' +
        '5 V with a red LED (Vforward ≈ 1.9 V) and 220 Ω that is about 14 mA — bright, and well inside ' +
        'the ATmega328P\'s 40 mA per-pin limit.',
    },
    {
      term: 'VCC, 5V, GND — the two rails',
      what:
        'VCC and 5V both mean "the positive supply". GND is ground: the return path every circuit needs ' +
        'to close. A pin outputs voltage relative to GND, so a circuit with nothing wired back to GND ' +
        'has nowhere for the current to go.',
    },
    {
      term: 'pinMode before digitalWrite',
      what:
        'A pin is an input until you say otherwise. digitalWrite on an input sets a tiny internal ' +
        'pull-up rather than driving the pin, which is why "I wrote HIGH and nothing happened".',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/digital/pinMode/',
    },
    {
      term: 'HIGH and LOW are voltages, not labels',
      what:
        'HIGH is the supply voltage — 5 V on the Uno — and LOW is 0 V. digitalWrite takes only those ' +
        'two values; anything between them is reached with analogWrite.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/digital/digitalWrite/',
    },
    {
      term: 'How a breadboard joins holes',
      what:
        'Internally, metal strips join five holes in each row sideways, and each power rail runs the ' +
        'whole length. The trench down the middle breaks every row in two: nothing joins across it. The ' +
        'two commonest first faults are a leg in the trench, and a row that looks adjacent but is not.',
    },
  ],
  writeUp: 'docs/exercises/module-0-first-light.md',
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    const channels = [
      { led: 'Red LED', pin: 'D8' },
      { led: 'Green LED', pin: 'D9' },
      { led: 'Blue LED', pin: 'D10' },
    ];

    channels.forEach(({ led: ledName, pin }, index) => {
      const led = simulation.addPart(part(ledName), PART_X, PART_Y + index * PART_STEP);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        PART_X + 62,
        PART_Y + index * PART_STEP,
      );
      const board = simulation.boardTerminal(pin);
      const anode = simulation.pinAt(led, 'anode');
      const cathode = simulation.pinAt(led, 'cathode');
      const legA = simulation.pinAt(resistor, 'a');
      const legB = simulation.pinAt(resistor, 'b');
      if (!board || !anode || !cathode || !legA || !legB) return;

      // Anode to the supply, cathode through the resistor to the pin. The pin
      // sinks the current, which is why the resistor can sit on either side and
      // the circuit is the same -- see the references.
      simulation.routeWire(supply, anode);
      simulation.routeWire(cathode, legA);
      simulation.routeWire(legB, board);
    });
  },
};

/**
 * Every exercise, in the order they are meant to be worked.
 *
 * The array order is the curriculum order, and the Learn page reads it as-is: a
 * learner arriving for the first time has not chosen a level, and being shown
 * 3.1 and 4.1 first would be a way of saying the ladder does not matter.
 */
export const EXERCISES: readonly Exercise[] = [
  FIRST_CIRCUIT,
  ...MODULE_1,
  ...MODULE_2,
  ...MODULE_3,
  ...MODULE_4,
];

/** The level a new reader starts at, and the one the page offers first. */
export const STARTING_LEVEL = 1;

/** The exercise a learner is on when they know nothing yet. */
export function firstExercise(): Exercise {
  return EXERCISES[0];
}

export function exerciseById(id: string): Exercise | null {
  return EXERCISES.find((exercise) => exercise.id === id) ?? null;
}
