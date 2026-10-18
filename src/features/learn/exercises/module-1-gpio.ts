/**
 * Module 1 -- GPIO & Physical Input Dynamics.
 *
 * The two exercises where digital input stops being simple. A mechanical
 * contact is not a switch, and a program that waits instead of checking is a
 * program that misses things. Both sketches here are written in the
 * interpreter's dialect: no `const` at file scope, no `enum`, no `struct`,
 * so the states and the button state are plain bytes.
 *
 * The prose for both lives in `docs/exercises/module-1-gpio.md`.
 */

import { CIRCUITS } from '../circuits';
import type { Exercise } from '../exercises';

/* ------------------------------------------------------------------ *
 * 1.1 -- Industrial Push-Button & Mechanical Debouncing
 * ------------------------------------------------------------------ */

const PUSH_BUTTON: Exercise = {
  id: '1.1',
  title: 'Industrial Push-Button & Mechanical Debouncing',
  level: 2,
  module: 'Module 1 — GPIO & Physical Input Dynamics',
  difficulty: 'Beginner',
  minutes: '45–60 mins',
  brief:
    'A mechanical button is not a switch: it is two metal surfaces that collide and ring for a few ' +
    'milliseconds, and a program that trusts the pin reads one press as five. You are wiring a button ' +
    'to an LED and writing the thing that fixes it — a debounce, which is a test for whether a level ' +
    'has settled rather than a pause to wait out the ringing.',
  concepts: [
    'A mechanical contact bounces for milliseconds',
    'INPUT_PULLUP inverts the button: pressed reads LOW',
    'A debounce is a stability test, not a delay',
    'Active-LOW fails safe when the wire breaks',
  ],
  parts: [
    {
      name: 'Tactile Button',
      qty: 1,
      why: 'The input. Four legs, but the two on each side are one terminal.',
    },
    { name: '220 Resistor', qty: 1, why: 'Sets the LED current. Not optional.' },
    {
      name: 'Red LED',
      qty: 1,
      why: 'Shows what the program currently believes the button is doing.',
    },
  ],
  wiring: [
    { pin: '5V', part: 'Red LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: 'D7', part: '220 Resistor', terminal: 'b', goesTo: 'Red LED cathode' },
    { pin: 'GND', part: '220 Resistor', terminal: 'a', goesTo: 'the blue − rail' },
    { pin: 'D2', part: 'Tactile Button', terminal: 'a', goesTo: "D2's row" },
    { pin: 'GND', part: 'Tactile Button', terminal: 'b', goesTo: 'the blue − rail' },
  ],
  steps: [
    'Run the red + rail from the 5V pin and the blue − rail from GND. A rail runs the whole length of the board: one long connection, not a row of them.',
    'Red LED: long leg (the anode) to the red + rail, short leg (the cathode) to a free row, and a 220 Ω resistor from that row to D7. The flat spot on the rim of the dome is the cathode side.',
    'Tactile Button: one leg into a free row of its own, the other leg into the blue − rail. The legs on each side of the body are joined inside the case, so the button has two terminals, not four.',
    "Run a jumper from the button's row to D2. Note which leg went to the pin — every decision about polarity downstream hangs on that.",
    'Clip the meter on D2 and GND before you write any code. Idle should read about 5 V; hold the button down and it should collapse to near 0 V. Seeing the two levels once makes the rest obvious.',
    'Run the sketch, open the Serial monitor, and press the button once — gently, then hard.',
  ],
  solution: {
    approach: [
      'The LED needs a 220 Ω in series with it, and the current has to be sunk by a pin rather than ' +
        'sourced by one — so the anode goes to the red + rail and the cathode, through the resistor, to ' +
        'D7. Any GPIO pin would light it just as well; D7 is chosen so the button has D2 to itself.',
      "The button's other leg goes to the blue − rail, so a held button pulls the pin to 0 V. On its " +
        'own that pin would float, so the pull-up has to be the internal one, set in code by ' +
        '`pinMode(PIN_BUTTON, INPUT_PULLUP)` — which is why this exercise has no pull-up resistor among ' +
        'its parts.',
      'That inversion settles every comparison downstream: pressed reads LOW, so the LED is lit by ' +
        'writing HIGH while the settled level is LOW. Swap the two button legs and the whole sketch has ' +
        'to be inverted instead, which is the same circuit wearing the wrong trousers.',
      'The debounce is a second pair of variables rather than a wait. `rawLevel` is what the pin says, ' +
        '`settledLevel` is what the program is prepared to believe, and `rawChangedAt` restarts on every ' +
        'raw edge. The window is 25 ms — long enough to outlast the worst bounce, short enough that a ' +
        'press still feels instant.',
    ],
    wiring: [
      {
        pin: '5V',
        terminal: 'anode',
        why:
          'The pin is the sink in this arrangement, so the LED has to be fed from the supply. Put the ' +
          'anode on the pin and the sketch inverts rather than fails — the LED lights when the ' +
          'program writes LOW, so it sits dark for the whole press and lit the whole time the button is ' +
          'released.',
      },
      {
        pin: 'D7',
        terminal: 'b',
        why:
          'This is the leg that carries current down to the sink pin. Any other GPIO pin would light ' +
          'the LED identically; landing it on a pin the sketch never names means the output stays at ' +
          'its setup value and the LED never comes on, however correct the code is.',
      },
      {
        pin: 'GND',
        terminal: 'a',
        why:
          'Without a return path there is no current, and an LED with no path is not a damaged LED — ' +
          'it simply never lights. That is the version of this fault that reads as a broken part.',
      },
      {
        pin: 'D2',
        terminal: 'a',
        why:
          'The pin has to be the one the debounce reads, since `PIN_BUTTON` is 2 and the meter check in ' +
          'the steps is taken on D2. Land the button on a neighbouring pin and nothing says so: the ' +
          'serial log simply never prints a press.',
      },
      {
        pin: 'GND',
        terminal: 'b',
        why:
          'This is the leg that pulls the pin down. Leave it unconnected and the internal pull-up holds ' +
          'D2 at 5 V for ever, so the sketch reports a permanently released button with no fault to ' +
          'see anywhere.',
      },
    ],
    working: [
      'The LED is dark while the button is untouched and lights while it is held, which is the pull-up ' +
        'inverting the input and the sink arrangement being right.',
      'The monitor prints `Ready. Press the button.` once, then one `press 1 at <ms>` line per press ' +
        'and a `release` line when the finger comes off. The counter is the proof that the debounce is ' +
        'filtering rather than merely delaying.',
      'The count rises by exactly one per press, gently or hard. Three or four for one press means the ' +
        'bounce is getting through; an LED still lit after you let go means the settled level has not ' +
        'been believed yet.',
      'A meter across D2 and GND sits near 5 V idle and collapses to about 0 V under the button, and the ' +
        'LED occupies exactly those two intervals — the wire and the program agree about the same signal.',
    ],
    traps: [
      'Both button legs in one breadboard row. The legs on each side of the body are already joined ' +
        'inside the case, so the switch is shorted across nothing. It feels entirely normal under the ' +
        'finger and the LED never changes, which is read as a dead switch rather than a mis-wire.',
      'The pull-up left off — `pinMode` says plain `INPUT`. Nothing then holds the pin at a defined ' +
        'level, its voltage wanders across the threshold, and the LED flickers and the counter creeps up ' +
        'with nobody touching anything. It looks like noise on a long wire.',
      'Believing the level as soon as it changes, without waiting for it to hold: the LED flickers and ' +
        'the log shows `press 1`, `press 2`, `press 3` for one press, and pressing harder makes it worse. ' +
        'Every one of those symptoms points at the button, not at the missing stability test.',
      'A resistor fitted across the button rather than in series with the LED. It is the same two ' +
        'components, the same row, and it does nothing visible at all — so the LED reads as unsoldered ' +
        'or the wrong colour rather than as a current limit that is in the wrong place.',
    ],
  },
  sketch: `#include <Arduino.h>

/*
 * Module 1 twin for 1.1 -- one button, one LED, one debounce.
 *
 * The pin numbers are plain globals rather than "const byte": the interpreter's
 * parser rejects const at file scope. Inside a function const is fine.
 */

byte PIN_BUTTON = 2;
byte PIN_LED    = 7;

// How long a level must hold before it is believed. 25 ms outlasts the worst
// bounce of a cheap tactile switch. 200 ms would also work, and every press
// would feel mushy.
unsigned long DEBOUNCE_MS = 25;

// The last level straight off the pin, bouncing and all.
byte rawLevel = HIGH;
// The last level we are prepared to believe.
byte settledLevel = HIGH;
// When rawLevel last moved. Any edge restarts the window.
unsigned long rawChangedAt = 0;
int pressCount = 0;

void setup() {
  // INPUT_PULLUP connects a resistor from the pin up to 5V inside the chip. An
  // untouched input therefore reads HIGH, and a press -- which pulls the pin
  // down to GND -- reads LOW. It inverts the button.
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  Serial.begin(9600);
  Serial.println("Ready. Press the button.");
}

void loop() {
  unsigned long now = millis();
  byte raw = digitalRead(PIN_BUTTON);

  // Any change restarts the clock. Bounce is a train of edges, so the window
  // only ever restarts: it is not satisfied until the contacts stop ringing.
  if (raw != rawLevel) {
    rawLevel = raw;
    rawChangedAt = now;
  }

  // Believe a level only once it has held still for longer than the bounce.
  // Subtracting rather than adding keeps this correct when millis() wraps.
  if (raw != settledLevel && now - rawChangedAt >= DEBOUNCE_MS) {
    settledLevel = raw;
    if (settledLevel == LOW) {
      pressCount++;
      Serial.print("press ");
      Serial.print(pressCount);
      Serial.print(" at ");
      Serial.println(now);
    } else {
      Serial.println("release");
    }
  }

  // Active-LOW: pressed is LOW, so pressed is LED-on. No delay() anywhere --
  // it is withdrawn from Level 2 onwards, because it stops the program reading
  // anything at all for as long as it waits.
  digitalWrite(PIN_LED, settledLevel == LOW ? HIGH : LOW);
}
`,
  fault: {
    break_:
      'Delete the debounce. Drive the LED straight from the read — ' +
      '`digitalWrite(PIN_LED, digitalRead(PIN_BUTTON) == LOW ? HIGH : LOW)` — and leave the window out of the comparison entirely.',
    teaches:
      'On a real bench one press now flickers the LED three or four times, and pressing harder ' +
      'makes it worse, because the contacts really did go open, closed, open, closed as the metal ' +
      'rebounded. The press counter in the Serial monitor is the real lesson: it says how many ' +
      'presses one press was. The twin cannot show this, because its switch is a clean 0.05 Ω ' +
      'contact with no ring to filter — which is worth knowing in itself.',
  },
  hints: [
    {
      when: 'The LED is lit all the time and goes out when I press the button.',
      answer:
        'The pull-up inverted it, and the polarity is easy to forget once. With INPUT_PULLUP the pin ' +
        'sits at 5 V while the button is untouched and drops to 0 V when pressed, so pressed is LOW. ' +
        'Either drive the LED with `settledLevel == LOW ? HIGH : LOW`, or swap which leg of the button ' +
        'goes to the pin.',
    },
    {
      when: 'Nothing happens at all, however hard I press.',
      answer:
        'Check the button before the code. The legs on one side of the body are joined internally, so ' +
        'if both of your "legs" landed in the same breadboard row the switch is shorted across nothing ' +
        'and does nothing forever, with no visible fault. Clip the meter on D2 and GND: it must sit at ' +
        'about 5 V and fall to near 0 V when held. If the numbers move, the wiring is right and the ' +
        'sketch is wrong.',
    },
    {
      when: 'One press makes the LED flicker several times, and pressing harder makes it worse.',
      answer:
        'That is bounce, and it is the fault this exercise exists to remove — so check the debounce ' +
        'before you look for anything exotic. A level is only accepted when `now - rawChangedAt` has ' +
        'reached DEBOUNCE_MS; if you compare the level but never wait for it to settle, you are ' +
        'counting every rebound. Measure rather than guess: print the raw read on every change with ' +
        'its timestamp, press once, and the worst gap in the log is your window.',
    },
    {
      when: 'The LED flickers on its own with nobody touching the button.',
      answer:
        'Nothing is holding the input at a defined level, so the pin is floating and its voltage ' +
        'wanders across the threshold as presses nobody made. Check that pinMode says INPUT_PULLUP ' +
        'rather than plain INPUT. A real cabinet wires an external 10 kΩ to the 5 V rail instead, ' +
        'because the internal one is only 20–50 kΩ and is switched off during reset — including ' +
        'throughout the upload — so an input that is valid in loop() can be floating a moment earlier.',
    },
    {
      when: 'Adding delay(50) after the read made the flicker go away. Was that the fix?',
      answer:
        'No, and it is the mistake this level exists to head off. delay() does not make the level ' +
        'stable; it stops the program reading anything at all for 50 ms, which on a control panel ' +
        'means the other inputs go blind while one button is being debounced. delay() is permitted at ' +
        'Level 1 and withdrawn from Level 2 onwards — every wait is now a comparison against millis().',
    },
  ],
  references: [
    {
      term: 'INPUT_PULLUP',
      what:
        'A third argument to pinMode that connects a resistor from the pin to 5 V inside the chip. ' +
        'An input left alone leaks so little current that its voltage wanders, so a switch wired to it ' +
        'reads whatever the noise says. The pull-up gives the pin a defined level to sit at. On the ' +
        'Uno it is 20–50 kΩ — weak, and switched off entirely during reset — which is why a real panel ' +
        'uses an external 10 kΩ instead.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/digital/pinMode/',
    },
    {
      term: 'Why a switch is not a switch',
      what:
        'When two contacts meet, the metal is compliant and the touching surfaces carry microscopic ' +
        'oxide. The contact compresses, rebounds, compresses again, and the oxide finally breaks into ' +
        'a conducting path — typically over 1–20 ms, with several transitions in between. A digital ' +
        'pin has no middling state, so it turns that ringing into two to forty clean logic edges. Count ' +
        'them and one press is many presses.',
    },
    {
      term: 'Debouncing',
      what:
        'Accepting a new level only once it has held for longer than the worst-case bounce. It is a ' +
        'stability test, not a wait: the program keeps running and keeps reading the other inputs while ' +
        'the window is open. The cost is that the first T milliseconds of every press are not yet ' +
        'believed, which is why the window is 20–50 ms and not 200 ms.',
    },
    {
      term: 'Active-LOW, and why the inversion is not arbitrary',
      what:
        'With a pull-up, an unpressed switch reads 5 V and a press reads 0 V, so pressed is LOW and ' +
        'every comparison inverts. It is the convention because it degrades safely: a broken wire, an ' +
        'unplugged connector or a pin that has not yet been configured all read as "released". A ' +
        'stuck-on button is an interesting fault; a machine that starts itself is an incident.',
    },
    {
      term: 'digitalRead',
      what:
        'Reads a pin and returns exactly HIGH or LOW — there is no intermediate value, which is why a ' +
        'few milliseconds of analogue ringing arrives as a burst of digital edges. On a pin configured ' +
        'as INPUT_PULLUP the returned level already includes the internal resistor.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/digital/digitalRead/',
    },
    {
      term: 'delay(), and what it costs',
      what:
        'Blocks the program for a fixed number of milliseconds. Nothing else runs: no other pin is ' +
        'read, no state machine advances, no button is debounced. It is a fine way to blink an LED and ' +
        'a wrong way to build anything that has more than one job, which is why this curriculum permits ' +
        'it at Level 1 and withdraws it from Level 2 onwards.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/delay/',
    },
  ],
  writeUp: 'docs/exercises/module-1-gpio.md',
  circuit: CIRCUITS['1.1'],
};

/* ------------------------------------------------------------------ *
 * 1.2 -- Traffic Signal State Machine
 * ------------------------------------------------------------------ */

const TRAFFIC_SIGNAL: Exercise = {
  id: '1.2',
  title: 'Traffic Signal State Machine',
  level: 2,
  module: 'Module 1 — GPIO & Physical Input Dynamics',
  difficulty: 'Beginner',
  minutes: '60–75 mins',
  brief:
    'A crossing controller must hold green for eight seconds, amber for two and a half, red for ' +
    'twelve, forever, and still answer a button press the instant it arrives. You are building that ' +
    'cycle as a state machine timed entirely from millis(), so nothing in the sketch ever stops to ' +
    'wait — and printing each state so you can watch the machine move.',
  concepts: [
    'A state machine: one variable names the mode, one comparison times it',
    'Non-blocking timing with millis()',
    'Transitions are checked every pass, never waited for',
    'now - start >= span survives the wrap; adding first does not',
  ],
  parts: [
    { name: 'Green LED', qty: 1, why: 'The go aspect: D6.' },
    {
      name: 'Yellow LED',
      qty: 1,
      why: 'Amber: D7. The shortest phase, and the one most often left out.',
    },
    { name: 'Red LED', qty: 1, why: 'The stop aspect: D8.' },
    { name: '220 Resistor', qty: 3, why: 'One per aspect, in series. Never an LED without one.' },
    {
      name: 'Tactile Button',
      qty: 1,
      why: 'Calls the phase forward. Its only job here is to prove the loop is awake.',
    },
  ],
  wiring: [
    { pin: '5V', part: 'Green LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: '5V', part: 'Yellow LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: '5V', part: 'Red LED', terminal: 'anode', goesTo: 'the red + rail' },
    { pin: 'D6', part: '220 Resistor', terminal: 'b', goesTo: 'Green LED cathode' },
    { pin: 'D7', part: '220 Resistor', terminal: 'b', goesTo: 'Yellow LED cathode' },
    { pin: 'D8', part: '220 Resistor', terminal: 'b', goesTo: 'Red LED cathode' },
    { pin: 'GND', part: '220 Resistor', terminal: 'a', goesTo: 'the blue − rail, one per aspect' },
    { pin: 'D2', part: 'Tactile Button', terminal: 'a', goesTo: "D2's row" },
    { pin: 'GND', part: 'Tactile Button', terminal: 'b', goesTo: 'the blue − rail' },
  ],
  steps: [
    'Run the red + rail from 5V and the blue − rail from GND before anything else.',
    'All three LEDs: long leg (anode) to the red + rail, short leg (cathode) to a row of its own, and a 220 Ω resistor from that row to its pin — green to D6, amber to D7, red to D8.',
    "Tactile Button on D2, exactly as in 1.1: one leg to D2's row, the other to the blue − rail. The sketch uses the internal pull-up, so there is no resistor on this node.",
    'Open the Serial monitor and raise it above the bench before you run. The sketch announces every state change and then reports twice a second.',
    'Watch one full cycle go by without touching anything. The four timestamps should read 8000 ms of green, then 2500 of amber, then 12000 of red — and the amber line and the next green line are 14500 ms apart.',
    'Now press the button during a green phase. Amber comes early, and amber and red then run their full lengths — which is what a machine does when it is told to change its mind.',
  ],
  solution: {
    approach: [
      'Three aspects means three pins and three resistors, and the sketch already names them: ' +
        '`LED_GREEN` 6, `LED_AMBER` 7, `LED_RED` 8. So green goes to D6, amber to D7 and red to D8. The ' +
        'amber pin is the one to decide carefully — it is the shortest phase and the aspect most often ' +
        'left out, so a swap there still produces a machine that looks like it runs.',
      'Every aspect is the sink arrangement from 1.1 repeated three times: anode to the red + rail, ' +
        'cathode through its own 220 Ω to its pin, and all three resistor `a` legs to the blue − rail. ' +
        'Sharing that rail is right; sharing one resistor between two aspects is not.',
      "The button is 1.1's circuit unchanged — one leg to D2, one to the blue − rail, no resistor, and " +
        '`pinMode(PIN_CALL, INPUT_PULLUP)` in setup so a press reads LOW. Its only job here is to prove ' +
        'the loop is awake, which is why the exercise bothers to include it at all.',
      'The machine itself is two variables and a set of constants: a state, the millis() stamp of when ' +
        'that state was entered, and 8000 / 2500 / 12000 ms for green / amber / red. Every change of ' +
        'state goes through `enterState()`, which writes all three aspects and the timestamp together, ' +
        'so no transition can forget to switch a light off.',
      'Each phase ends in a comparison — `now - stateEntered >= span` — re-checked on every pass, and ' +
        'never a `delay()`. Subtracting rather than adding the span is what keeps the machine running ' +
        'past the 49.7-day rollover of millis().',
    ],
    wiring: [
      {
        pin: '5V',
        terminal: 'anode',
        why:
          'The anode side is identical for all three aspects, and it is the one that makes each pin a ' +
          'sink. Put an anode on its pin instead and that aspect lights when the program writes LOW — ' +
          'so the signal runs while the crossing is stopped and stays dark while it is released.',
      },
      {
        pin: '5V',
        terminal: 'anode',
        why:
          'Same reasoning, and the shared + rail is what lets one 5V terminal feed all three aspects. ' +
          'Wiring this anode to ground while the others go to the rail leaves one aspect that can only ' +
          'ever be dark.',
      },
      {
        pin: '5V',
        terminal: 'anode',
        why:
          'Red is the aspect the machine starts and idles in, so it is lit longer than the other two ' +
          'put together. A red anode on a different rail is invisible for the first eight seconds of ' +
          'every cycle and then looks like a phase that hangs.',
      },
      {
        pin: 'D6',
        terminal: 'b',
        why:
          'This is the leg the sketch drives `LED_GREEN` on, and its number is chosen only because the ' +
          'constants say so. Land it on a neighbouring pin and the green aspect never lights while the ' +
          'state machine cheerfully prints GREEN for eight seconds at a time.',
      },
      {
        pin: 'D7',
        terminal: 'b',
        why:
          'Amber is the shortest phase and the one most easily transposed. Swap it with D8 and the ' +
          'machine still cycles and the timestamps still look right — but the light shown for 12 ' +
          'seconds is now the one the code calls red, so the fault presents as a timing bug.',
      },
      {
        pin: 'D8',
        terminal: 'b',
        why:
          'The stop aspect has to reach the pin the sketch drives `LED_RED`. On a pin the sketch never ' +
          'writes, the red LED sits dark for the whole twelve seconds and the crossing reads as ' +
          'uncontrolled rather than as one mis-placed resistor.',
      },
      {
        pin: 'GND',
        terminal: 'a',
        why:
          'One resistor per aspect, all returning to the blue − rail — sharing the rail row is fine, ' +
          'sharing a single resistor is not. Leave one `a` leg unconnected and that aspect has no ' +
          'return path, so it never lights and looks like the failed LED rather than the loose leg.',
      },
      {
        pin: 'D2',
        terminal: 'a',
        why:
          '`PIN_CALL` is 2, and this is the only row the button can reach the program through. On any ' +
          'other pin the phases still run on their own and the monitor still reports them, so the ' +
          'button simply appears to be a part that does nothing.',
      },
      {
        pin: 'GND',
        terminal: 'b',
        why:
          'The leg that pulls D2 down. Unconnected, the pull-up holds the pin at 5 V for ever, the ' +
          'press is never accepted, and the cycle looks completely healthy while the button is inert.',
      },
    ],
    working: [
      'Exactly one aspect is lit at any moment and the other two are dark, and every move is announced ' +
        'by a `-> AMBER at <ms>` line. The absence of two lit aspects is the proof that all three writes ' +
        'went through `enterState()` rather than half of them from loop().',
      'The twice-a-second report counts the phase down: 8 s left on green, 2 on amber, 12 on red, and ' +
        'the amber line and the next green line are 14500 ms apart. Those numbers are the spans, and a ' +
        'countdown rather than a freeze is the proof that nothing is sleeping.',
      'A press during green brings amber forward at once, and amber and red then run their full lengths ' +
        '— the loop was never blocked, so the request was read on the very next pass.',
      'A held button advances the phase once and then nothing more, and the monitor stays quiet until ' +
        'the button is released. A counter that climbs on every pass is the tell that the release is ' +
        'being counted as a request too.',
    ],
    traps: [
      'Amber on D8 and red on D7. The machine still cycles, still prints the right state names and ' +
        'still uses the right spans, so nothing in the output is wrong — the aspect that lights for 2.5 ' +
        'seconds is simply the one that ran for 12. It reads as a mistake in millis() rather than a swap ' +
        'on the board.',
      'Driving the aspects from loop() as well as from `enterState()`. Two writers, one pin, and the ' +
        'last one to run wins, so an aspect can stay lit after the state has already moved on. The ' +
        'symptom is a light stuck on, which is what a failed LED looks like.',
      'Ending each phase with `delay(GREEN_MS)` instead of a comparison. Every timestamp is correct and ' +
        'the cycle is perfect, so the sketch looks finished — and every press made during a phase is ' +
        'lost, which is the entire point of the exercise and the one thing nothing on the bench reveals.',
      'Treating the release as a request as well as the press. Two transitions per press, and a press ' +
        'during green jumps straight to red. The state names in the log are all legal, so the fault ' +
        'survives a whole evening of watching before anyone suspects the button.',
    ],
  },
  sketch: `#include <Arduino.h>

/*
 * Module 1 twin for 1.2 -- a three-phase crossing, timed without delay().
 *
 * The interpreter's parser covers no enum, so the states are #defines.
 */

#define GREEN 0
#define AMBER 1
#define RED   2

byte LED_GREEN = 6;
byte LED_AMBER = 7;
byte LED_RED   = 8;
byte PIN_CALL  = 2;

unsigned long GREEN_MS = 8000;
unsigned long AMBER_MS = 2500;
unsigned long RED_MS   = 12000;
unsigned long DEBOUNCE_MS = 25;
unsigned long REPORT_MS  = 500;

// The whole machine is these two: a state, and when we arrived in it.
byte state = RED;
unsigned long stateEntered = 0;
unsigned long lastReportAt = 0;

// The button from 1.1, unchanged -- the same problem in a smaller place.
byte callRaw = HIGH;
byte callSettled = HIGH;
unsigned long callChangedAt = 0;

// Every state change goes through here, so the LEDs and the timestamp can never
// drift apart, and no transition can forget to switch an aspect off.
void enterState(byte next) {
  state = next;
  stateEntered = millis();
  digitalWrite(LED_GREEN, next == GREEN ? HIGH : LOW);
  digitalWrite(LED_AMBER, next == AMBER ? HIGH : LOW);
  digitalWrite(LED_RED, next == RED ? HIGH : LOW);
  Serial.print("-> ");
  Serial.print(next == GREEN ? "GREEN" : next == AMBER ? "AMBER" : "RED");
  Serial.print(" at ");
  Serial.println(stateEntered);
}

// True only on the pass where a settled press is accepted. INPUT_PULLUP again,
// so a press reads LOW, and a level is believed only once it has held still
// for longer than the bounce.
bool callAccepted(unsigned long now) {
  byte raw = digitalRead(PIN_CALL);
  if (raw != callRaw) {
    callRaw = raw;
    callChangedAt = now;
  }
  if (now - callChangedAt < DEBOUNCE_MS) { return false; }
  if (raw == callSettled) { return false; }
  callSettled = raw;
  // Only a press is a request. Releasing the button re-arms it; it does not
  // call the phase forward, or every press would advance two states.
  return raw == LOW;
}

void setup() {
  Serial.begin(9600);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_AMBER, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(PIN_CALL, INPUT_PULLUP);
  enterState(RED);
}

void loop() {
  unsigned long now = millis();
  // Unsigned subtraction, so this stays correct across the 49.7-day wrap.
  unsigned long inState = now - stateEntered;

  // A press calls the phase forward, in any state. Nothing is sleeping, so
  // nothing is missed: this is the whole point of the exercise.
  if (callAccepted(now)) {
    if (state == RED) { enterState(GREEN); }
    else if (state == GREEN) { enterState(AMBER); }
    else { enterState(RED); }
  }

  // A press may have moved us, so read the clock again: judging a phase that
  // just started by the previous phase's elapsed time takes two transitions in
  // one pass, and the state you land in is one nobody asked for.
  inState = now - stateEntered;

  // The transitions: check them every pass, never wait for one.
  if (state == GREEN && inState >= GREEN_MS) { enterState(AMBER); }
  else if (state == AMBER && inState >= AMBER_MS) { enterState(RED); }
  else if (state == RED && inState >= RED_MS) { enterState(GREEN); }

  // One more read, for the same reason: a transition above has reset it again.
  inState = now - stateEntered;

  // Twice a second, not once per pass -- a monitor you cannot read is no
  // monitor at all.
  if (now - lastReportAt >= REPORT_MS) {
    lastReportAt = now;
    unsigned long span = state == GREEN ? GREEN_MS : state == AMBER ? AMBER_MS : RED_MS;
    Serial.print(state == GREEN ? "GREEN " : state == AMBER ? "AMBER " : "RED   ");
    Serial.print((span - inState) / 1000);
    Serial.println(" s left");
  }
}
`,
  fault: {
    break_:
      'Rewrite the green transition as `if (state == GREEN && now >= stateEntered + GREEN_MS)`, ' +
      'and the other two to match. It looks equivalent to the subtraction, and it runs perfectly.',
    teaches:
      'It runs for forty-nine days, seventeen hours and about three minutes. Then millis() rolls ' +
      'over to zero, `stateEntered + GREEN_MS` becomes a small number instead of a large one, the ' +
      'comparison goes false, and the machine stands still in whatever state it was in — a crossing ' +
      'whose lights never change again. Unsigned subtraction keeps the borrow; adding first throws ' +
      'it away.',
  },
  hints: [
    {
      when: 'Two aspects are lit at once.',
      answer:
        'A state that has no transition out of it. Every change of state must go through enterState(), ' +
        'and enterState() must switch all three aspects — one on, the other two off — rather than ' +
        'turning on the one it wants. If you are driving LEDs from the loop as well as from ' +
        'enterState(), the two writers disagree and one of them wins last.',
    },
    {
      when: 'A phase occasionally runs far too long, then gives up and jumps to the next one.',
      answer:
        'You are moving the phase timestamp on more passes than you meant to. Reaching for the ' +
        'deadline inside the button branch without re-arming means a held button pushes `stateEntered` ' +
        'forward on every pass and the phase never expires. Move it only when a press is first ' +
        'accepted, and keep comparing `now - stateEntered >= span` rather than a stored target.',
    },
    {
      when: 'The button only seems to do something between phases.',
      answer:
        'Something is blocking. Look for delay() — including a delay() that has crept back in to hold ' +
        'a phase — and for a `while (digitalRead(PIN_CALL) == HIGH) { }` style wait for the button. ' +
        'Neither is allowed here: nothing may stop the loop, and every wait has to be a comparison ' +
        'against millis() that the next pass re-checks.',
    },
    {
      when: 'The Serial monitor is scrolling away with thousands of lines a second.',
      answer:
        'You are printing inside the sampling loop, so the cost of the output has become part of the ' +
        'timing. Rate-limit it: keep the last print timestamp, and only emit when ' +
        '`now - lastReportAt >= REPORT_MS`. Two lines a second is enough to watch a machine, and ' +
        'nothing else should be printed at all.',
    },
    {
      when: 'It runs beautifully all evening and then the lights freeze.',
      answer:
        'Almost certainly the wrap. millis() is a 32-bit count and rolls over after 49.7 days; if a ' +
        'comparison adds the span to the start time rather than subtracting the start time from now, ' +
        'the sum wraps to a small number and the test silently stops firing. Compare elapsed against ' +
        'the span — `now - stateEntered >= GREEN_MS` — and unsigned arithmetic does the rest.',
    },
  ],
  references: [
    {
      term: 'millis()',
      what:
        'Milliseconds since the board was reset, as an unsigned long, counting forever. Reading it ' +
        'costs a few microseconds and stops nothing, which is what makes it the basis of every ' +
        'non-blocking wait: take the time now, do your work, and compare against it later. ' +
        'delay() is the same clock, spent blocking.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/millis/',
    },
    {
      term: 'The 49.7-day wrap',
      what:
        'millis() returns 32 bits, so after 2^32 ms — 49 days, 17 hours — it rolls over to zero. ' +
        'Unsigned arithmetic is defined modulo 2^32, which is why `now - stateEntered` keeps working ' +
        'across the rollover: the borrow comes out right and the difference is a small positive ' +
        'number. `now > stateEntered + span` loses that borrow — the sum wraps small, the comparison ' +
        'goes false, and a timed state can hang forever.',
    },
    {
      term: 'Why a state machine and not a chain of delays',
      what:
        'A controller written as `delay(8000); greenOff(); delay(2500); amberOff();` has a duration ' +
        'that is a property of its own instruction stream: reorder two statements and the phase ' +
        'lengths change, and add a Serial.println on the hot path and amber is a little longer. A ' +
        'state machine inverts that — the state names the mode, one set of constants says how long each ' +
        'mode lasts, and the transition logic is the only place behaviour changes.',
    },
    {
      term: 'delay() and what it costs',
      what:
        'Blocks the program for a fixed number of milliseconds: no pin is read, no state advances, no ' +
        'press is noticed. In a traffic controller that is not a style complaint, it is a requirement ' +
        'failure — a button pressed during a delay has to wait for the delay to finish before ' +
        'anything can see it. This curriculum permits delay() at Level 1 and withdraws it from ' +
        'Level 2 onwards.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/delay/',
    },
    {
      term: 'Serial output, and why it is rate-limited',
      what:
        'The monitor is a text view of what the program says, and a state machine is invisible until ' +
        'it says which state it is in. Print on transitions, not on passes: a sketch that prints ' +
        'every time through loop() turns the output into the bottleneck and buries the transition ' +
        'lines among thousands of identical ones. Two lines a second is plenty for watching a cycle.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/serial/Serial/',
    },
  ],
  writeUp: 'docs/exercises/module-1-gpio.md',
  circuit: CIRCUITS['1.2'],
};

export const MODULE_1: readonly Exercise[] = [PUSH_BUTTON, TRAFFIC_SIGNAL];
