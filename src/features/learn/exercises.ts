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

import type { CircuitDocument, FirmwareLanguage } from '@/features/simulation';
import { boardOption, type BoardId } from './boardRegistry';
import { EXERCISE_BOARD } from './exercises/shared';
import { CIRCUITS } from './circuits';
import { MODULE_1 } from './exercises/module-1-gpio';
import { MODULE_2 } from './exercises/module-2-analog';
import { MODULE_5_MAPS } from './exercises/module-5-maps';
import { MODULE_5_SBC } from './exercises/module-5-single-board-computers';
import { MODULE_5_NETWORKS } from './exercises/module-5-networks';
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

/**
 * A worked answer to an exercise.
 *
 * The sketch is not this. The sketch is already printed in full on the exercise
 * page, because a learner who cannot read the finished program will not be able
 * to tell a wrong one from a right one. What a sketch cannot show is the part
 * that actually transfers: why the wiring is shaped the way it is, which of two
 * plausible wirings is the one that works, and what a finished circuit is
 * supposed to do when you look at it.
 *
 * So a solution is reasoning rather than code. It is written to be read after a
 * genuine attempt and before the last hint, which is the only point where it
 * teaches anything -- read first it is transcription, and the exercise stops
 * being worth doing.
 */
export interface ExerciseSolution {
  /**
   * How to get from the brief to a working circuit, in the order it happens.
   *
   * Each step is one decision, not one action. The order is the point: most of
   * these exercises are finished the moment the reader decides what the pin
   * numbers are for, and the wiring afterwards is transcription.
   */
  readonly approach: readonly string[];
  /**
   * The wiring, jumper by jumper, with the reason each one is where it is.
   *
   * Keyed on the same pin and terminal names as `Exercise.wiring` so the two
   * tables can be read together, which is the whole point: the wiring table
   * says what to connect, and this says what would happen if you connected
   * something else there instead.
   */
  readonly wiring: readonly {
    readonly pin: string;
    readonly terminal: string;
    readonly why: string;
  }[];
  /** What you should see when it is right, and what that proves. */
  readonly working: readonly string[];
  /**
   * The mistakes that look like something other than a mistake.
   *
   * Every one of these produces a symptom a beginner reads as a broken part
   * rather than a wrong wire, which is what makes them worth naming.
   */
  readonly traps: readonly string[];
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
  /**
   * The board this exercise is written for, when it is not the curriculum's.
   *
   * Almost every lesson here is an Uno lesson and leaves this unset. A lesson
   * about a single-board computer has to say so, because the numbers in that
   * lesson -- 3.3 V logic, no analogue input, BCM pin numbers -- are that
   * board's, and an Uno's wiring put on a Pi would teach every one of them
   * wrongly.
   */
  readonly board?: BoardId;
  /** The grammar its sketch is written in, when the board's default is not it. */
  readonly language?: FirmwareLanguage;
  readonly wiring: readonly ExerciseWiring[];
  /** The build order, so nobody has to work it out from the table. */
  readonly steps: readonly string[];
  /**
   * The worked answer, when there is one to give.
   *
   * Optional because an exercise with no solution is a legitimate state -- a
   * work in progress, or one open-ended enough that a single answer would be a
   * lie. Making the field required would mean inventing one rather than leaving
   * it honestly absent.
   */
  readonly solution?: ExerciseSolution;
  /** The sketch the twin runs. Loaded by "Put it on the bench". */
  readonly sketch: string;
  /** What to try that should not work, and what it teaches. */
  readonly fault?: { readonly break_: string; readonly teaches: string };
  readonly hints: readonly ExerciseHint[];
  readonly references: readonly ExerciseReference[];
  /** The full write-up, for the learner who wants to read rather than do. */
  readonly writeUp: string;
  /** The circuit this exercise needs, as a document (see `circuits/`). */
  readonly circuit: CircuitDocument;
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
  solution: {
    approach: [
      'The sketch writes to three different pins, so the circuit has to be three independent channels ' +
        'rather than one LED the program moves around. One LED, one resistor, one pin — that is the ' +
        'decision, and everything after it is placement.',
      'Those pins are D8, D9 and D10, and the sketch already names them, so read the pin numbers off ' +
        'the code rather than off the board. Not D13: it carries an LED and a resistor of its own, so ' +
        'a correct build and a broken one look identical. D0 and D1 are the serial pins and stay free.',
      'Each LED straddles the two rails rather than sitting on a pin: long leg (anode) to the 5V rail, ' +
        'short leg (cathode) out to a 220 Ω resistor, and the far leg of that resistor to the pin. ' +
        'Keeping the resistor on the cathode side leaves every long leg on one conductor, so a mistake ' +
        'shows up as a single dark LED instead of three.',
      'The pin is the switch, and the pin is the only thing the program ever touches — nothing reaches ' +
        'a pin except through a resistor. A LED wired straight to a pin is the fault this exercise ' +
        'asks you to break later, not the circuit you are building now.',
      'The return path is one wire, not three. The blue − rail is a single conductor running the length ' +
        'of the board, so one jumper to GND closes all three channels at the same time.',
    ],
    wiring: [
      {
        pin: '5V',
        terminal: 'anode',
        why:
          'The anode is the long leg, and it is the side the current arrives at. Putting it on the 5V ' +
          'rail rather than on a pin is what leaves the program in charge of whether this LED is lit; ' +
          'an LED wired straight to a pin is lit by whatever else happens to be on that pin.',
      },
      {
        pin: 'D8',
        terminal: 'b',
        why:
          "This is the leg the sketch's `digitalWrite(RED, HIGH)` is aimed at, and the resistor in it " +
          'is the only thing limiting the current. Leave it out and the LED does not merely get ' +
          'brighter — the pin pays for it, which is the fault this exercise ends with.',
      },
      {
        pin: 'D9',
        terminal: 'anode',
        why:
          'Same rule as red, and the reason the three stay tellable apart is that they sit on three ' +
          'pins. Give two of them the same pin and they collapse into one channel that is on or off ' +
          'together, which reads as a program bug rather than a wiring one.',
      },
      {
        pin: 'D9',
        terminal: 'b',
        why:
          'Each LED needs its own resistor; the three share the rails and nothing else. Two LEDs ' +
          "sharing one means the second changes the first's brightness, and uneven or flickering light " +
          'is read as a failing LED rather than as a shared component.',
      },
      {
        pin: 'D10',
        terminal: 'anode',
        why:
          'Blue runs at a higher forward voltage than red, so on the same resistor it is always the ' +
          'dimmer of the three — that is the part, not a fault. The anode still has to be the long leg ' +
          'on the rail, or this channel never lights at all.',
      },
      {
        pin: 'D10',
        terminal: 'b',
        why:
          'The wiring here is identical to the other two by design, so the pin number is the only ' +
          'thing keeping the third channel separate. Land this one on D9 as well and you get two LEDs ' +
          'switching together, which looks like `loop()` is not doing what it says.',
      },
      {
        pin: 'GND',
        terminal: 'a',
        why:
          'The blue − rail is one conductor, so this single jumper closes all three channels at once. ' +
          'GND is not a spare terminal — it is the other end of every circuit, and a pin is only ever ' +
          'driving a voltage relative to it. Without a path back, the pin is pushing into open air and ' +
          'every LED stays dark at once, which looks like a dead board rather than a missing wire.',
      },
    ],
    working: [
      'Press Run and exactly one LED is lit at a time, stepping red, then green, then blue every 400 ms ' +
        'and starting again. That is the proof each channel is complete on its own: a dark LED would ' +
        'mean a gap in that one loop, not in the board.',
      'No two LEDs ever come on together. If they do, two of the pin numbers in the sketch do not ' +
        'match the wires, and the LEDs themselves are the last thing to suspect.',
      'Red and green come out near equal brightness and blue is visibly dimmer. Same 220 Ω, same 5 V, ' +
        'higher forward voltage — the difference is in the part, so the dim one is not a fault to chase.',
      'Change a pin number in the sketch and the colour that answers changes while the breadboard stays ' +
        'put. That is the LEDs responding to code, which is the whole idea of the exercise.',
    ],
    traps: [
      'The LED is in backwards — long leg to the resistor, short leg to the rail. It then never lights ' +
        'on any pin and in any sketch, which is indistinguishable from a dead LED. The long leg is the ' +
        'anode, and the flat spot on the rim of the dome is on the cathode side.',
      'A 10k Resistor where a 220 Resistor belongs. The LED does light, but at roughly 0.3 mA instead ' +
        'of 14 mA, so in a bright room it reads as a failed part rather than as a resistor that is too ' +
        'large. Check the colour bands before blaming the LED.',
      'Both legs of one LED land in the same breadboard row. A row is five holes joined by a metal ' +
        'strip, so the LED is shorted out around its resistor: that channel is dead while the other two ' +
        'behave perfectly, and the arrangement looks entirely reasonable.',
      'A leg sits in the trench down the middle of the board, or the − rail was never actually run down ' +
        'to GND. Nothing at all lights, and on a first circuit the sensible conclusion — dead board, ' +
        'dead LEDs — is the wrong one, because a single missing connection looks exactly the same.',
    ],
  },
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
        "runs at about 3.0 V forward voltage against red's 1.9 V, so blue is always the dimmer one " +
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
        "the ATmega328P's 40 mA per-pin limit.",
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
  circuit: CIRCUITS['0.1'],
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
  ...MODULE_5_MAPS,
  ...MODULE_5_SBC,
  ...MODULE_5_NETWORKS,
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

/**
 * The board an exercise is written for.
 *
 * The curriculum's board is the default rather than a field every one of the
 * thirty exercises has to repeat, so a lesson about something else names its
 * own and the rest stay as they were.
 */
export function exerciseBoard(exercise: Exercise): BoardId {
  return exercise.board ?? (EXERCISE_BOARD as BoardId);
}

/**
 * The grammar an exercise's sketch is in.
 *
 * An exercise says so itself when it needs to; otherwise it follows the board
 * it was written for, because that is where the answer actually lives. It is
 * not "is this a microcontroller or a single-board computer" -- a lesson on an
 * ESP32 is a C++ lesson like any other, and reading a board name as a proxy for
 * a language is the kind of shortcut that is right twice and wrong the third
 * time.
 */
export function exerciseLanguage(exercise: Exercise): FirmwareLanguage {
  return exercise.language ?? boardOption(exerciseBoard(exercise)).language;
}
