/**
 * Module 4 -- Hardware Interrupts & Low-Level Control.
 *
 * Both exercises here have something the interpreter cannot give the learner,
 * and neither hides it. The simulator models no interrupts: there is no
 * `attachInterrupt` to call, no pin-change interrupt, no `ATOMIC_BLOCK`, and
 * `volatile` lexes as a keyword the declaration grammar will not accept. A
 * sketch that called `attachInterrupt` anyway would load, run, and quietly
 * decode nothing -- an unknown call in the interpreter's builtin dispatch
 * returns 0 rather than failing. So the twins are written in the dialect that
 * works, and each one says in a comment, a hint and a reference exactly what
 * the real hardware buys and why the bench version is not a smaller version of
 * the twin.
 *
 * Everything else the module is about survives intact. 4.1 drives the real
 * quadrature transition table -- the part learners get wrong, and the part an
 * interrupt handler would drive identically. 4.2 is a full non-blocking state
 * machine with a timing window that aborts instead of hanging.
 *
 * See `shared.ts` for the catalogue lookup and the bench coordinates the
 * modules share.
 */

import { CIRCUITS } from '../circuits';
import type { Exercise } from '../exercises';

/** The module name both exercises carry, so the list page can group them. */
const MODULE = 'Module 4 — Hardware Interrupts & Low-Level Control';


/* ------------------------------------------------------------------ *
 * 4.1 -- High-Speed Rotary Encoder
 * ------------------------------------------------------------------ */

const ROTARY_ENCODER: Exercise = {
  id: '4.1',
  title: 'High-Speed Rotary Encoder',
  level: 5,
  module: MODULE,
  difficulty: 'Advanced',
  minutes: '90–120 mins',
  brief:
    'A CNC spindle panel: a hand-wheel where one detent is one count and no ' +
    'motion is lost, plus an optical sensor reading shaft speed off a 24-slot ' +
    'disc. Both signals arrive faster than a loop can look at them, so the ' +
    'bench build routes them into interrupt handlers. This twin keeps the ' +
    'decoder — the Gray-code transition table that decides which of the sixteen ' +
    'state-to-state moves are clockwise, which are anticlockwise, and which are ' +
    'contact bounce to be thrown away — and proves it by polling.',
  concepts: [
    'Quadrature encoding: two lines, four states, one bit changes per step',
    'A transition table, not a "did anything change" test',
    'Interrupts, volatile, and the cost of a handler',
  ],
  parts: [
    {
      name: 'Rotary Encoder (KY-040)',
      qty: 1,
      why:
        'Two outputs and a push contact. CLK and DT are the quadrature pair, SW is ' +
        'the press. It only produces a correct Gray cycle with VCC wired.',
    },
  ],
  wiring: [
    { pin: '5V', part: 'Rotary Encoder (KY-040)', terminal: 'VCC', goesTo: 'the board 5 V pin' },
    { pin: 'GND', part: 'Rotary Encoder (KY-040)', terminal: 'GND', goesTo: 'the board GND pin' },
    { pin: 'D2', part: 'Rotary Encoder (KY-040)', terminal: 'CLK', goesTo: 'the clock line' },
    { pin: 'D3', part: 'Rotary Encoder (KY-040)', terminal: 'DT', goesTo: 'the data line' },
    { pin: 'D4', part: 'Rotary Encoder (KY-040)', terminal: 'SW', goesTo: 'the press contact' },
  ],
  steps: [
    'Find the encoder\'s five pins, in a single column: CLK, DT, SW, VCC, GND.',
    'Wire VCC to 5 V and GND to GND first. The module\'s outputs are 10 kΩ pull-ups to VCC, so with VCC left off they float and every reading is noise.',
    'Wire CLK to D2 and DT to D3. On the Uno those two are the only pins with external interrupts, and the bench build needs both.',
    'Wire SW to D4. It is active-LOW and already pulled up inside the module; INPUT_PULLUP is only belt and braces.',
    'Put the sketch on the bench and run it. The serial line prints counts and rejected transitions twice a second.',
    'Turn the Detents knob one step at a time and watch counts move by exactly 1 while rejected stays at 0.',
    'Now break it on purpose: pull the VCC jumper and turn the knob again. Read the references below before you decide what the fix is.',
  ],
  solution: {
    approach: [
      'The pin numbers here are chosen by what the Uno can do with them, not by convenience. ' +
        'CLK and DT are the quadrature pair and D2 and D3 are the only two pins with external ' +
        'interrupt vectors, so those two pins go to those two lines and nothing else does.',
      'The decoder is a lookup, not a change test: index the table by previous * 4 + current, ' +
        'with the state packed as (CLK ? 2 : 0) + (DT ? 1 : 0). Four states and sixteen moves, of ' +
        'which eight are illegal — and CLK has to be the high bit, because that is what makes one ' +
        'walk round the whole cycle come out +1 every step.',
      'Illegal does not mean ignore, it means count it and carry on. Bounce crosses the same edge ' +
        'twice, so `state` is written on every transition, legal or not: that is what makes the ' +
        'second bounce compare against the truth and get rejected rather than becoming a second count.',
      'The state has to be seeded from the pins in `setup()` rather than from zero, because the ' +
        'encoder has already been turned by the time the sketch runs. A zero seed invents a ' +
        'transition the mechanism never made, and the first detent pays for it.',
      'SW goes to D4 and stays there. A push is slow enough to poll and edge-detect in software, ' +
        'which keeps both interrupt vectors for the pair of lines that genuinely needs them.',
    ],
    wiring: [
      {
        pin: '5V',
        terminal: 'VCC',
        why:
          'The encoder\'s three outputs are open-collector with 10 kΩ pull-ups to VCC, so this is ' +
          'the wire that gives CLK, DT and SW defined levels. Leave it off and they float: ' +
          '`digitalRead` returns whatever the bench has, and counts and rejected both climb with ' +
          'nobody touching the knob — which reads as contact bounce rather than as a missing supply.',
      },
      {
        pin: 'GND',
        terminal: 'GND',
        why:
          'Without a return path the pull-ups have nothing to pull against, so all three lines sit ' +
          'at an undefined level. That is the version of the fault that looks like a dead encoder: ' +
          'the module is fine and the board simply has no reference for it.',
      },
      {
        pin: 'D2',
        terminal: 'CLK',
        why:
          'CLK carries the high bit of the packed state, and D2 is INT0 — one of the two vectors ' +
          'that can catch this line changing. Land it on any other pin and the bench build loses ' +
          'every edge that falls between two polls, which is the failure this whole module exists ' +
          'to explain.',
      },
      {
        pin: 'D3',
        terminal: 'DT',
        why:
          'DT carries the low bit, so the two lines are interchangeable to the hardware and not to ' +
          'the table. Swapped, the decoder still moves one count per detent — it just reads every ' +
          'direction the other way round, which looks like a knob wired backwards rather than like ' +
          'two jumpers crossed.',
      },
      {
        pin: 'D4',
        terminal: 'SW',
        why:
          'The press contact is active-LOW and already pulled up inside the module, so `INPUT_PULLUP` ' +
          'here is belt and braces and the pin number is free — but it must not be D2 or D3, or the ' +
          'pair lose an interrupt vector to something that could have been polled. On a pin the ' +
          'sketch never reads, the serial line simply never prints a press.',
      },
    ],
    working: [
      'One detent moves the count by exactly 1 anticlockwise or clockwise, and `rejected` stays at ' +
        '0. That is the table agreeing with itself round the whole Gray cycle, not merely counting ' +
        'changes.',
      'Pressing SW prints one `press,counts,rejected` line, and the count in it is the count at ' +
        'that press — the press being edge-detected against the previous reading, because the ' +
        'contact reads LOW rather than HIGH.',
      'A `counts=… rejected=…` line every half second shows the loop alive with nothing turning. A ' +
        'count that creeps on its own is the fault and not the result: the same line is how you ' +
        'catch a floating input before you touch the table.',
      'Turning fast enough that the polling misses edges — `rejected` climbing and the count lagging ' +
        'behind the knob — is the symptom interrupts exist to cure. The twin polls, so it can show ' +
        'the problem and never the cure; the sketch header says so, and the transition table it is ' +
        'proving is the part that is identical either way.',
    ],
    traps: [
      'VCC left off, which is the fault this exercise is built around. The lines float, so the count ' +
        'and the rejection counter both climb with the knob untouched — and because rejection is ' +
        'supposed to mean bounce, that reads as a worn encoder rather than as an unpowered module.',
      'Reading CLK and DT in two separate `digitalRead` calls. An edge can fall between them, the ' +
        'pair then disagree about which state it is in, and the decoder invents a move that never ' +
        'happened: the count drifts by ±1 with nobody turning anything.',
      'Treating the eight zero rows as "nothing happened" instead of as rejections. Bounce is then ' +
        'applied as motion and one detent counts four, which reads as having written an x1 decoder ' +
        'against an x4 encoder rather than as having dropped the illegal rows.',
      'Seeding `state` to 0 instead of reading the pins in `setup()`. The first detent then compares ' +
        'the encoder\'s real resting state against a state it was never in, so `rejected` jumps by ' +
        'one the instant you start turning — a first-movement fault that looks like the very first ' +
        'detent being a bad one.',
    ],
  },
  sketch: `/*
 * Noesis Lab twin for 4.1 -- the quadrature transition table, driven by polling.
 *
 * THE LIMIT, STATED UP FRONT: this simulator models no interrupts. There is no
 * attachInterrupt to call, no pin-change interrupt, no ATOMIC_BLOCK, and the
 * parser has no 'volatile'. A call to attachInterrupt would parse, run, and do
 * nothing at all -- an unknown function in the builtin dispatch returns 0
 * rather than failing -- so this twin would print zero counts for ever while
 * looking like the interrupt build. That is why it polls instead.
 *
 * What the bench build has that this does not: the edge is caught even when it
 * falls between two digitalRead calls, the handler can afford to be 20 us long
 * and still miss nothing, and the shared counter can be read without tearing.
 * Prove the table here first; the table is the part that is actually hard.
 *
 * Plain globals rather than "const byte": the parser rejects const at file
 * scope. Values and logic are otherwise unchanged from the bench sketch.
 */

int PIN_CLK = 2, PIN_DT = 3, PIN_SW = 4;

// previous * 4 + current, with state = (CLK ? 2 : 0) + (DT ? 1 : 0).
// +1 clockwise, -1 counter-clockwise, 0 illegal -- bounce, or both lines
// changing in the same instant. Eight of the sixteen entries are 0, and an
// illegal transition is counted, never applied.
//
// Check it by walking one direction round the whole cycle: 3 -> 1 -> 0 -> 2 -> 3
// is indices 13, 4, 2, 11 and all four must be +1. The other direction is
// 3 -> 2 -> 0 -> 1 -> 3, indices 14, 8, 1, 7, all -1. A table that does not
// agree with itself round the loop has a transposition in it, and the damage
// shows up only on the moves out of the resting state -- the first detent.
int QUAD_TABLE[16] = {
  0, -1,  1,  0,    1,  0,  0, -1,   -1,  0,  0,  1,    0,  1, -1,  0
};

int state = 0;
int swHeld = 1;
long counts = 0, rejected = 0;
long lastReportMs = 0;

void setup() {
  pinMode(PIN_CLK, INPUT);
  pinMode(PIN_DT, INPUT);
  pinMode(PIN_SW, INPUT_PULLUP);

  // Seed from the resting state, or the first turn looks like one illegal jump.
  state = (digitalRead(PIN_CLK) == HIGH ? 2 : 0) + (digitalRead(PIN_DT) == HIGH ? 1 : 0);

  Serial.begin(9600);
  Serial.println("press,counts,rejected");
}

void loop() {
  // Read both lines together. Reading one and inferring the other is the single
  // most common way a decoder invents counts.
  int curr = (digitalRead(PIN_CLK) == HIGH ? 2 : 0) + (digitalRead(PIN_DT) == HIGH ? 1 : 0);

  if (curr != state) {
    int step = QUAD_TABLE[state * 4 + curr];
    if (step != 0) {
      counts = counts + step;
    } else {
      rejected = rejected + 1;
    }
    state = curr;   // written either way: bounce still moves the state on.
  }

  int pressed = digitalRead(PIN_SW) == LOW ? 1 : 0;
  if (pressed == 1 && swHeld == 0) {
    Serial.print(pressed); Serial.print(",");
    Serial.print(counts);   Serial.print(",");
    Serial.println(rejected);
  }
  swHeld = pressed;

  // A running report, so a stalled count is visible without pressing anything.
  long nowMs = millis();
  if (nowMs - lastReportMs >= 500) {
    lastReportMs = nowMs;
    Serial.print("counts="); Serial.print(counts);
    Serial.print(" rejected="); Serial.println(rejected);
  }
}`,
  fault: {
    break_:
      'Pull the encoder\'s VCC jumper out of 5 V and turn the knob. The serial line fills with counts and rejected transitions that mean nothing.',
    teaches:
      'CLK, DT and SW are open-collector outputs with 10 kΩ pull-ups to VCC, not driven lines. ' +
      'Unpowered, they float and digitalRead returns whatever noise the bench has. A floating ' +
      'input is not a reading, and on real hardware it is a symptom worth chasing back to the ' +
      'supply before you touch the firmware.',
  },
  hints: [
    {
      when: 'The count doubles or halves — four per detent where I expected one, or the reverse.',
      answer:
        'You have written an x1 decoder against an x4 encoder. A real KY-040 crosses four Gray ' +
        'states per mechanical detent, so x4 decoding gives 80 counts per revolution of a 20-detent ' +
        'encoder. If you are seeing four per detent but only counting one, your table is probably ' +
        'missing its illegal rows and applying bounce as motion. Print the table entry you used ' +
        'against the state pair, and check the eight zeros really are zero.',
    },
    {
      when: 'Turn the knob quickly and counts arrive only when I go slowly — faster turns are undercounted.',
      answer:
        'That is exactly the failure this exercise is about, and it is what interrupts are for. ' +
        'Polling samples the lines a few thousand times a second; an edge that falls between two ' +
        'samples is simply gone, and no firmware trick recovers it from a polled loop. The fix is ' +
        'attachInterrupt(0, isr, CHANGE) and attachInterrupt(1, isr, CHANGE) on the bench, which ' +
        'catches the transition the moment it happens. This simulator has no interrupts, so the ' +
        'twin can show you the problem and never the cure.',
    },
    {
      when: 'Everything works until I move the work out of loop() and into a handler, and then it gets worse.',
      answer:
        'A handler is not a normal function. Anything it shares with loop() must be volatile, or ' +
        'the compiler keeps its own cached copy in a register and never sees the handler\'s write. ' +
        'And volatile is not atomic: on this 8-bit core a long is 32 bits and takes four ' +
        'instructions to read, so a read that straddles the handler\'s store comes back torn — ' +
        'you would see 3 and 4, or −1 and 0. Wrap wide reads in ATOMIC_BLOCK, and keep the handler ' +
        'under about 20 µs: no delay(), no Serial, nothing that can miss the next edge.',
    },
    {
      when: 'The count drifts by a ±1 every few seconds with nothing touching the knob.',
      answer:
        'That one is not the signal, it is the read. On hardware it is the torn 32-bit read: a ' +
        'bare load of a long counter can straddle the handler\'s store and return a value that never ' +
        'existed. Guard it with ATOMIC_BLOCK(ATOMIC_RESTORESTATE). If it happens here, check instead ' +
        'that nothing else in loop() writes counts, and that state is written on every illegal ' +
        'transition as well as every legal one.',
    },
  ],
  references: [
    {
      term: 'Interrupts and attachInterrupt',
      what:
        'An interrupt is a pin event that runs a function of yours without the program asking. ' +
        'attachInterrupt(interrupt, handler, mode) names the one, and mode is CHANGE for a ' +
        'transition in either direction. The CPU pushes a return address, jumps, runs the handler, ' +
        'and comes back — so the handler must leave the machine exactly as it found it, and must be ' +
        'back before the next edge arrives.',
      readMore:
        'https://docs.arduino.cc/language-reference/en/functions/external-interrupts/attachInterrupt/',
    },
    {
      term: 'The Uno has exactly two, and that is the whole exercise',
      what:
        'External interrupt 0 is D2 and external interrupt 1 is D3. Nothing else. A KY-040 needs ' +
        'both CLK and DT watched, so both interrupts are spent by one encoder and the optical ' +
        'tachometer is left over — D5 has no external interrupt at all, and attachInterrupt(5, ...)' +
        ' selects the PORTD pin-change interrupt, whose group covers all of D0–D7, so every ' +
        'encoder edge vectors into the handler too. The real build guards that by re-reading the ' +
        'port and rejecting a level that did not actually change.',
    },
    {
      term: 'volatile, and why a plain variable is not enough',
      what:
        'The compiler may read a variable into a register once and reuse it for the rest of a ' +
        'loop, because nothing in that code appears to write it. An interrupt handler does write ' +
        'it, but the compiler cannot see across that boundary, so loop() keeps reading its own ' +
        'stale copy. volatile tells the compiler to go to memory every time. It is the minimum, ' +
        'not the whole answer: on an 8-bit core a value wider than 16 bits is still not read ' +
        'atomically, and a four-byte read can catch the handler mid-write.',
    },
    {
      term: 'The interrupt budget',
      what:
        'One cycle on a 16 MHz AVR is 62.5 ns, and entry plus exit for a non-minimal handler costs ' +
        '40–60 cycles before your first instruction runs — roughly 20–30 k interrupts/s is the ' +
        'practical ceiling. At 3000 RPM a 24-slot disc gives 1200 pulses/s, or 2400 edges/s under ' +
        'change detection: at 20 µs per handler that is 48 ms of every second, about 5 %. That ' +
        'arithmetic, not intuition, is why bounce is rejected in the wire filter rather than in ' +
        'the handler.',
    },
    {
      term: 'Gray code, and the sixteen-entry table',
      what:
        'The two encoder lines cycle through four states with only one bit changing per step: ' +
        '11 → 01 → 00 → 10 → 11, or the reverse. Encoding a state as (CLK ? 2 : 0) + (DT ? 1 : 0) ' +
        'and indexing a table by previous * 4 + current gives +1 clockwise, −1 anticlockwise, 0 ' +
        'illegal. Eight of the sixteen indices are illegal: 3, 6, 9 and 15 are both lines changing ' +
        'at once, and 0, 5, 10 and 14 are the bounce shape where a line returns to the state it ' +
        'left. Those must be counted and rejected, never guessed at.',
    },
    {
      term: 'Why this twin polls, and what polling costs you',
      what:
        'The simulator models no interrupt mechanism at all — no attachInterrupt, no pin-change ' +
        'interrupt, no atomic block, and no volatile in the dialect. So the twin decodes by ' +
        'polling, which is honest about the technique and dishonest about the speed: it will never ' +
        'miss an edge, because there are no real edges, only the knob position. Two more limits: ' +
        'one Detents step here is one Gray state, not one mechanical detent, so the twin proves ' +
        'the decoder rather than the 80 counts per revolution; and the modelled contacts change ' +
        'state cleanly, so rejected stays 0 and every filter decision is a Scope experiment on ' +
        'real hardware.',
    },
  ],
  writeUp: 'docs/exercises/module-4-interrupts.md',
  circuit: CIRCUITS['4.1'],
};


/* ------------------------------------------------------------------ *
 * 4.2 -- Distance Radar with the HC-SR04
 * ------------------------------------------------------------------ */

const ULTRASONIC_RADAR: Exercise = {
  id: '4.2',
  title: 'Distance Radar with an Ultrasonic Sensor',
  level: 5,
  module: MODULE,
  difficulty: 'Advanced',
  minutes: '60–75 mins',
  brief:
    'A reverse-parking sensor: five LEDs report the distance band and a passive ' +
    'buzzer beeps faster the closer the wall gets. The bar has to keep updating ' +
    'while it is being driven, which rules out any measurement that blocks the ' +
    'loop for the length of the echo — up to 23 ms. You are building a five-state ' +
    'sequence that never blocks, times the round trip with micros(), and divides ' +
    'by two.',
  concepts: [
    'Sound at 343 m/s, and why the round trip is halved',
    'A non-blocking state machine instead of pulseIn or delay()',
    'A timing window that aborts rather than hangs',
  ],
  parts: [
    {
      name: 'Ultrasonic Sensor (HC-SR04)',
      qty: 1,
      why:
        'The transducer and the echo timer. TRIG takes the 10 µs burst; ECHO is a ' +
        'genuine open-drain output whose high time is the round trip.',
    },
    { name: 'Green LED', qty: 2, why: 'The two nearest bands. Under 30 cm lights both.' },
    { name: 'Yellow LED', qty: 2, why: 'The two middle bands, 30–60 cm and 60–100 cm.' },
    { name: 'Red LED', qty: 1, why: 'The far band: anything past 200 cm.' },
    {
      name: '220 Resistor',
      qty: 5,
      why:
        'One per LED, in series. From I = (5 V − Vf) / R that is about 13 mA per ' +
        'pin, and five lit is 69 mA against the board\'s 200 mA budget.',
    },
    {
      name: '10k Resistor',
      qty: 1,
      why:
        'ECHO back to 5 V. The model already carries a 10 kΩ pull-up, so this sits ' +
        'in parallel and changes nothing electrically — fit it anyway, because the ' +
        'real breadboard needs it and ECHO must never be left floating.',
    },
    {
      name: 'Piezo Buzzer',
      qty: 1,
      why: 'The audible half of the report: 2 kHz, interval set by the distance band.',
    },
  ],
  wiring: [
    { pin: '5V', part: 'Ultrasonic Sensor (HC-SR04)', terminal: 'VCC', goesTo: 'the board 5 V pin' },
    { pin: 'GND', part: 'Ultrasonic Sensor (HC-SR04)', terminal: 'GND', goesTo: 'the board GND pin' },
    { pin: 'D6', part: 'Ultrasonic Sensor (HC-SR04)', terminal: 'TRIG', goesTo: 'the trigger line' },
    { pin: 'D7', part: 'Ultrasonic Sensor (HC-SR04)', terminal: 'ECHO', goesTo: 'the ECHO node' },
    { pin: '5V', part: '10k Resistor', terminal: 'a', goesTo: 'the red + rail' },
    { pin: 'D7', part: '10k Resistor', terminal: 'b', goesTo: 'the ECHO node' },
    { pin: '5V', part: 'Green LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: 'D2', part: '220 Resistor', terminal: 'b', goesTo: 'Green LED cathode' },
    { pin: 'D3', part: '220 Resistor', terminal: 'b', goesTo: 'Green LED cathode' },
    { pin: 'D4', part: '220 Resistor', terminal: 'b', goesTo: 'Yellow LED cathode' },
    { pin: 'D5', part: '220 Resistor', terminal: 'b', goesTo: 'Yellow LED cathode' },
    { pin: 'D8', part: '220 Resistor', terminal: 'b', goesTo: 'Red LED cathode' },
    { pin: 'D9', part: 'Piezo Buzzer', terminal: 'positive', goesTo: 'the buzzer drive pin' },
  ],
  steps: [
    'Power the module first: VCC to 5 V, GND to the rail. Do not feed it from 3V3.',
    'Wire TRIG straight to D6. Leave it alone after that — the sketch drives it, you do not.',
    'Wire ECHO to D7, with the 10 kΩ from that node back to 5 V. A floating ECHO reads noise, and the sketch will publish the timeout as a distance.',
    'Wire the five LEDs with a 220 Ω each: anodes to the red + rail, cathodes to D2, D3, D4, D5 and D8, so the pin sinks the current.',
    'Wire the piezo\'s positive terminal to D9. Each LED and the buzzer gets its own pin, so the bar can update without blocking.',
    'Put the sketch on the bench and run it. The CSV line prints ms, raw µs, centimetres and a valid flag five times a second.',
    'Set the sensor\'s Distance knob to 100 cm. raw_us should read 5800 and the distance about 100.',
    'Drop it to 2 cm and back to 400 cm, and watch the lit count step 5, 4, 3, 2 across each band edge.',
  ],
  solution: {
    approach: [
      'The two sensor pins are decided by direction before anything else. TRIG is driven — ' +
        '`PIN_TRIG` is 6, and the burst is a HIGH held for 10 µs — and ECHO is listened to, on ' +
        'D7, because the high time on that line is the measurement. Swapped, the sketch pulses a ' +
        'pin nothing watches and reads a pin it drives itself.',
      'ECHO is open-drain: it pulls the line low and does nothing else, so it needs the 10 kΩ back ' +
        'to 5 V before the first reading is taken. A floating line is not a reading, and this ' +
        'sketch will publish the noise as a distance.',
      'The divide-by-two is already in the constant. ECHO rises when the burst leaves and falls ' +
        'when the first reflection returns, so 58.1 µs is the round trip for one centimetre at ' +
        '20 °C and `CM_PER_US` is that reciprocal. Halving it a second time gives exactly double ' +
        'the real distance, which is the shape of a calibration fault and is not one.',
      'The measurement is spread across iterations — one state per pass, each entered and left on ' +
        'a `micros()` or `millis()` comparison — because the echo can run 23 ms and the bar has to ' +
        'keep updating through it. `millis()` is far too coarse for the 10 µs burst, which is the ' +
        'only reason `micros()` is here at all.',
      'The remaining windows belong to the module, not to the sketch: 60 ms between bursts or ' +
        'echoes start going missing as noise, and 25 ms as the ceiling or 400 cm could not be ' +
        'reported at all. The bands are cumulative, so a close wall lights four LEDs and the count ' +
        'falls one at a time as it retreats, which is what says how close rather than that something ' +
        'is there.',
    ],
    wiring: [
      {
        pin: '5V',
        terminal: 'VCC',
        why:
          'The module needs the full 5 V, and it shares the board\'s ground reference with the ' +
          'ECHO pull-up. On 3V3 the burst is short and the echo comes back weak, so the sketch ' +
          'measures a module that is barely switched on — which reads as a tired transducer rather ' +
          'than an underpowered one.',
      },
      {
        pin: 'GND',
        terminal: 'GND',
        why:
          'Without a shared reference the 10 µs burst and the echo it produces are measured against ' +
          'nothing, and ECHO sits at an undefined level. Nearly every "the sensor is dead" report ' +
          'starts here rather than at the part.',
      },
      {
        pin: 'D6',
        terminal: 'TRIG',
        why:
          'This is the line the sketch drives, and the pin number is only the sketch\'s choice of ' +
          'which pin to write HIGH for 10 µs. Land it on a pin `setup()` never puts in `OUTPUT` and ' +
          'no burst is ever transmitted, so every reading comes back as no target however good the ' +
          'code is.',
      },
      {
        pin: 'D7',
        terminal: 'ECHO',
        why:
          '`PIN_ECHO` is 7 and the high time on this line is the whole measurement. On a pin the ' +
          'module is not driving, the sketch times whatever its own last `digitalWrite` left behind — ' +
          'and with D6 and D7 crossed, that is a zero on every line for ever.',
      },
      {
        pin: '5V',
        terminal: 'a',
        why:
          'This leg is the top of the pull-up that makes ECHO a logic high at all, since the module ' +
          'only ever pulls the line down. On GND instead, the line is held low for ever and the ' +
          'sketch reports the module as permanently silent.',
      },
      {
        pin: 'D7',
        terminal: 'b',
        why:
          'The pull-up belongs at the ECHO node itself, sharing that row with the module\'s output. ' +
          'A pull-up on a neighbouring row is a pull-up of nothing: ECHO floats, and floating ECHO ' +
          'is indistinguishable from no target — so the bar goes dark intermittently and looks like ' +
          'a wiring fault somewhere else.',
      },
      {
        pin: '5V',
        terminal: 'anode',
        why:
          'Every anode goes to the supply so that the pin sinks, which is also what keeps each band ' +
          'independent — nothing else on that row is carrying the current. Anode on the pin and ' +
          'cathode on the rail inverts all five at once, and the bar sits dark while the serial line ' +
          'goes on printing perfectly good distances.',
      },
      {
        pin: 'D2',
        terminal: 'b',
        why:
          'The nearest band, under 30 cm: `PIN_LED1` is 2, and it is the one that stays lit while the ' +
          'others drop away. On a pin the sketch never writes, the bar reads as though it had three ' +
          'bands instead of four, and the fault looks like a threshold rather than a jumper.',
      },
      {
        pin: 'D3',
        terminal: 'b',
        why:
          'The under-60 cm band, `PIN_LED2`. Miss this one and the step from two lit LEDs to one ' +
          'happens at 60 cm instead, which reads as the sketch\'s comparison being wrong rather than ' +
          'as a resistor on the wrong pin.',
      },
      {
        pin: 'D4',
        terminal: 'b',
        why:
          'The under-100 cm band, `PIN_LED3`. The band boundaries and the pin numbers have to agree; ' +
          'when they do not the bar changes shape at the wrong distance while the number in the CSV ' +
          'line stays correct, which is the hardest kind of fault to spot.',
      },
      {
        pin: 'D5',
        terminal: 'b',
        why:
          'The under-200 cm band, `PIN_LED4`, the last of the four that light as the wall comes in. ' +
          'Lose it and a wall at 150 cm is indistinguishable from one at 250 cm on the display.',
      },
      {
        pin: 'D8',
        terminal: 'b',
        why:
          'The far band, past 200 cm: `PIN_LED5` is 8, and it is the only LED lit at 400 cm, which ' +
          'is what separates "nothing close" from "nothing there". D8 rather than D10 or D13 keeps ' +
          'those free for SPI; on a pin the sketch never writes, a distant wall and a dead sensor ' +
          'look identical.',
      },
      {
        pin: 'D9',
        terminal: 'positive',
        why:
          '`PIN_BUZZER` is 9 — deliberately not one of the LED pins, so the note never contends with ' +
          'a band for the same pin, and not D10–D13, which stay free. Share a pin with an LED and the ' +
          'beep stops tracking distance, which reads as the gap arithmetic being wrong rather than ' +
          'as two loads on one output.',
      },
    ],
    working: [
      'With the Distance knob at 100 cm the CSV line reads 5800 in the raw µs column and about 100 ' +
        'in the distance column. That pair is the round-trip constant doing the halving for you, in ' +
        'one line.',
      'The valid column stays at 1 for every line at every distance in range, which is the proof that ' +
        'an abort is reported as no target rather than as a number nobody measured.',
      'Dropping the knob to 2 cm lights D2, D3, D4 and D5 together and shortens the beep gap to ' +
        'about 100 ms; walking back out drops one band at a time and stretches the gap to 1000 ms. ' +
        'The bar is cumulative, so the count of lit LEDs is the distance.',
      'Nothing freezes during a reading: the LEDs and the buzzer keep moving through the longest ' +
        'echo. That is the state machine earning its place, and it is precisely what the one-line ' +
        '`pulseIn` version cannot do.',
    ],
    traps: [
      'The 10 kΩ left off the ECHO node. The line floats, so readings alternate between 0 and the ' +
        'full timeout and the bar goes dark — a symptom that points at the transducer, because a ' +
        'transducer is the part you can see.',
      'TRIG and ECHO crossed. The sketch pulses D6 and reads D7, so it ends up bursting into a pin ' +
        'nothing is watching and timing a pin it drives itself: every line reads 0 cm, and the CSV ' +
        'output looks like the sensor has simply stopped answering.',
      'Halving twice — dividing the raw µs by two as well as using the round-trip constant. Every ' +
        'reading comes back exactly double, which looks like a calibration error on the part rather ' +
        'than an arithmetic slip, and a factor of exactly two is the tell.',
      'Bursting faster than the 60 ms recovery floor allows. The oscillator cannot be re-triggered ' +
        'that soon, and echoes start going missing in a way that looks like noise: the bar flickers ' +
        'and the readings jump, which reads as an unreliable sensor rather than as a module being ' +
        'asked a question before it has answered the last one.',
    ],
  },
  sketch: `/*
 * Noesis Lab twin for 4.2 -- the non-blocking radar sequence.
 *
 * Plain types only: no enum (the state constants are spelled out) and no const
 * at file scope, which the parser will not accept.
 *
 * The one substitution from the bench sketch is marked TWIN below. Everything
 * else -- the 10 us burst, the settle window, the timeout, the 60 ms recovery
 * floor, the five bands and the beep schedule -- is the bench firmware.
 */

// 58.1 us is the ROUND TRIP for one centimetre at 20 C, so 1/58.1 already
// carries the divide-by-two. Carried pre-multiplied too, because the
// interpreter's '/' truncates toward zero the way C does: rawUs / 58.1 would
// floor to 0 for every distance under 58 cm.
float CM_PER_US = 0.0172117;

int PIN_TRIG = 6, PIN_ECHO = 7, PIN_BUZZER = 9;
int PIN_LED1 = 2, PIN_LED2 = 3, PIN_LED3 = 4, PIN_LED4 = 5, PIN_LED5 = 8;

int IDLE = 0, TRIGGERED = 1, SETTLE = 2, WAIT_ECHO = 3, PROCESS = 4;

long TRIGGER_HOLD_US = 10, SETTLE_US = 500, ECHO_TIMEOUT_US = 25000;
long RECOVER_MS = 60, CSV_MS = 200, HALF_PERIOD_US = 250, NOTE_US = 40000;

int sonarState = IDLE, echoSeen = 0, valid = 0;
long stateEnteredUs = 0, lastTriggerMs = 0, rawUs = 0;
long lastCsvMs = 0, lastBeepMs = 0, beepStartUs = 0;
float distanceCm = 0.0;

void enterSonarState(int next) {
  sonarState = next;
  stateEnteredUs = micros();
  if (next == TRIGGERED) { digitalWrite(PIN_TRIG, LOW); lastTriggerMs = millis(); }
  if (next == WAIT_ECHO) echoSeen = 0;
}

void setup() {
  pinMode(PIN_TRIG, OUTPUT);   digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_LED1, OUTPUT);    digitalWrite(PIN_LED1, LOW);
  pinMode(PIN_LED2, OUTPUT);    digitalWrite(PIN_LED2, LOW);
  pinMode(PIN_LED3, OUTPUT);    digitalWrite(PIN_LED3, LOW);
  pinMode(PIN_LED4, OUTPUT);    digitalWrite(PIN_LED4, LOW);
  pinMode(PIN_LED5, OUTPUT);    digitalWrite(PIN_LED5, LOW);
  Serial.begin(9600);
  Serial.println("ms,raw_us,distance_cm,valid");
}

void loop() {
  long nowUs = micros();
  long nowMs = millis();

  if (sonarState == IDLE) {
    // The oscillator cannot be re-triggered immediately: the datasheet asks
    // for 60 ms, and bursting faster makes echoes go missing as noise.
    if (nowMs - lastTriggerMs >= RECOVER_MS) enterSonarState(TRIGGERED);

  } else if (sonarState == TRIGGERED) {
    digitalWrite(PIN_TRIG, HIGH);
    if (nowUs - stateEnteredUs >= TRIGGER_HOLD_US) {
      digitalWrite(PIN_TRIG, LOW);
      enterSonarState(SETTLE);
    }

  } else if (sonarState == SETTLE) {
    // Give the module 500 us to raise ECHO before the echo is believed.
    if (nowUs - stateEnteredUs >= SETTLE_US) enterSonarState(WAIT_ECHO);

  } else if (sonarState == WAIT_ECHO) {
    /*
     * TWIN -- the one substitution. The bench sketch polls the ECHO rising and
     * falling edges with digitalRead and micros(), and aborts on its own
     * ECHO_TIMEOUT_US. This model raises ECHO only inside a pulseIn call, so
     * that poll could never see a level change and the sketch would report "no
     * target" for ever. pulseIn supplies the same measurement and reports the
     * timeout as 0, so the invalid path still exercises.
     *
     * It is also the banned one-liner: pulseIn spins for the whole echo, up to
     * 23 ms of real loop time, and the LED bar and buzzer stall for it.
     */
    rawUs = pulseIn(PIN_ECHO, HIGH, ECHO_TIMEOUT_US);
    echoSeen = rawUs > 0 ? 1 : 0;
    enterSonarState(PROCESS);

  } else {
    float cm = rawUs * CM_PER_US;
    valid = echoSeen == 1 && cm >= 2.0 && cm <= 400.0 ? 1 : 0;
    distanceCm = cm;

    // Cumulative bands: close enough lights all five, which is what tells the
    // driver how close, not just that something is there.
    digitalWrite(PIN_LED1, cm < 30.0 ? HIGH : LOW);    digitalWrite(PIN_LED2, cm < 60.0 ? HIGH : LOW);
    digitalWrite(PIN_LED3, cm < 100.0 ? HIGH : LOW);  digitalWrite(PIN_LED4, cm < 200.0 ? HIGH : LOW);
    digitalWrite(PIN_LED5, cm < 200.0 ? LOW : HIGH);

    // Shorter gap, closer wall. Silent when nothing valid answered.
    long gap = valid == 0 ? 0
      : cm < 30.0 ? 100 : cm < 60.0 ? 200 : cm < 100.0 ? 400 : cm < 200.0 ? 700 : 1000;
    if (gap > 0 && nowMs - lastBeepMs >= gap) { lastBeepMs = nowMs; beepStartUs = nowUs; }

    enterSonarState(IDLE);
  }

  // 2 kHz square wave, driven by hand: one edge every 250 us.
  if (beepStartUs > 0 && nowUs - beepStartUs < NOTE_US) {
    digitalWrite(PIN_BUZZER, (nowUs - beepStartUs) % (2 * HALF_PERIOD_US) < HALF_PERIOD_US ? HIGH : LOW);
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    beepStartUs = 0;
  }

  if (nowMs - lastCsvMs >= CSV_MS) {
    lastCsvMs = nowMs;
    Serial.print(nowMs);      Serial.print(",");
    Serial.print(rawUs);      Serial.print(",");
    Serial.print(distanceCm); Serial.print(",");
    // valid is set before the value is published, never after.
    Serial.println(valid == 1 ? "1" : "0 no target");
  }
}`,
  fault: {
    break_:
      'Set the sensor\'s Distance knob past 170 cm and drop ECHO_TIMEOUT_US to 10000 in the sketch. Every reading comes back 0 and the bar goes dark.',
    teaches:
      'An echo wider than the window you gave it is not a distance — it is a measurement that did ' +
      'not happen. pulseIn reports that as 0, which converts to 0 cm; a timed-out poll leaves the ' +
      'timeout value behind, which converts to a large one. Either way the invalid flag has to be ' +
      'set before the number is printed, or the driver gets a number nobody measured.',
  },
  hints: [
    {
      when: 'Every reading is exactly double the real distance.',
      answer:
        'That is the round trip, not a calibration error. ECHO goes high when the burst leaves and ' +
        'low when the first reflection comes back, so the high time is out-and-home. Divide by two — ' +
        'or use the round-trip constant, since 58.1 µs is already the round trip for one centimetre ' +
        'at 20 °C. A factor of exactly two, rather than an offset, rules out temperature and ' +
        'resistor drift.',
    },
    {
      when: 'The reading is 0 cm, or it is always 0.',
      answer:
        'pulseIn returning 0 means either nothing answered inside the timeout or the line never went ' +
        'high. Check the wiring first: TRIG on D6 and ECHO on D7, the two swapped, gives exactly ' +
        'this, because the sketch pulses one pin and reads a pin nothing drives. Then check that ' +
        'ECHO has its pull-up to 5 V and that VCC is actually wired — an unpowered module leaves ' +
        'ECHO floating, and a floating line reads as no target.',
    },
    {
      when: 'Every so often the reading comes back as the full 25 ms timeout.',
      answer:
        'Nothing answered inside your window: either the sensor was not triggered, or the window is ' +
        'shorter than the echo you are asking about. 400 cm is 23 260 µs, so a 25 ms ceiling leaves ' +
        'little room — and the module cannot be re-triggered sooner than 60 ms after the last burst, ' +
        'or echoes start going missing in a way that looks like noise. The fix is to honour both the ' +
        'recovery floor and the timeout, and to report the abort as "no target" rather than as a number.',
    },
    {
      when: 'The LEDs freeze for a fraction of a second every time it reports.',
      answer:
        'Something is blocking. The usual culprit is the one-liner: unsigned long us = ' +
        'pulseIn(PIN_ECHO, HIGH, ECHO_TIMEOUT_US); spins for the whole echo, up to 23 ms, and the ' +
        'bar and buzzer stall with it. That is what the state machine is for — one state per ' +
        'iteration, each step entered and left on a millis()/micros() comparison, nothing called that ' +
        'waits.',
    },
  ],
  references: [
    {
      term: 'micros(), and what its resolution buys you',
      what:
        'millis() counts milliseconds since the sketch started, which is far too coarse for a 10 µs ' +
        'burst. micros() counts microseconds: a 32-bit unsigned long, so it rolls over every 2^32 µs, ' +
        'about 71.6 minutes. Unsigned subtraction makes that wrap harmless — you always get the ' +
        'forward distance from the last edge — but the result still has to be range-checked before ' +
        'it is believed. Real hardware resolves to 4 µs, not 1.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/micros/',
    },
    {
      term: 'Sound travels at 343 m/s, and the round trip is halved',
      what:
        'The HC-SR04 fires a 10 µs burst of 40 kHz ultrasound, and ECHO stays high until the first ' +
        'reflection returns. That high time covers the distance twice, so d = t × v / 2. In ' +
        'centimetres one round trip at 20 °C takes 58.1 µs — v = 331.3 + 0.606T, which is 343.4 m/s at ' +
        '20 °C and 346.5 at 25 °C. Ignore temperature and you carry about 4 % error, more than the ' +
        'sensor\'s own accuracy.',
    },
    {
      term: 'The timing window, and the 60 ms recovery floor',
      what:
        'The oscillator cannot be re-triggered immediately; the datasheet asks for at least 60 ms ' +
        'between bursts, and going faster makes echoes go missing in a way that reads as noise. At ' +
        'the other end, 400 cm is 23 260 µs of echo, so a 25 ms timeout is wider than the longest ' +
        'legitimate echo and still narrow enough to report a missing target promptly. Below about ' +
        '2 cm is a blind zone — the transducer cannot separate its own ring-down from a return.',
    },
    {
      term: 'Why pulseIn is banned here, and what it costs',
      what:
        'pulseIn(pin, level, timeout) is a single line that times a pulse for you. It is also a ' +
        'busy-wait: it spins until the pin changes or the timeout expires, so the whole echo — up to ' +
        '23 ms — is loop() time the bar and the buzzer do not have. On hardware you replace it with ' +
        'the rising and falling edge of ECHO detected by digitalRead, stamped with micros(), and a ' +
        'timeout branch that aborts. pulseIn with an explicit end time is fine for tone(); it is the ' +
        'echo measurement that has to be spread across iterations.',
    },
    {
      term: 'ECHO is open-drain, and the divider is not optional off the Uno',
      what:
        'ECHO is a genuine open-drain output: it pulls the line low and does nothing else, so it ' +
        'needs a pull-up to 5 V and must never be left floating or the sketch will publish the ' +
        'timeout as a distance. On the Uno the pin is 5 V tolerant, so no divider is needed. On a ' +
        '3.3 V board it is: 5 × 2k / (1k + 2k) = 3.33 V is the design\'s whole reason, and omitting ' +
        'it is how a GPIO dies. The twin cannot show you this — its ECHO is a modelled open-drain ' +
        'line, not a 5 V push-pull output.',
    },
  ],
  writeUp: 'docs/exercises/module-4-interrupts.md',
  circuit: CIRCUITS['4.2'],
};

/** Module 4's exercises, in curriculum order. */
export const MODULE_4: readonly Exercise[] = [ROTARY_ENCODER, ULTRASONIC_RADAR];