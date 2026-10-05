/**
 * Module 2 -- Analog Interfaces & Signals.
 *
 * The two exercises where a pin stops being a yes or a no. Both sketches are
 * written in the interpreter's dialect, and both of them trip over the same
 * two edges of it: there are no `A0`..`A5` aliases, so the ATmega328P GPIO
 * numbers are named directly, and there is no `log()`, so the thermistor's beta
 * curve in 2.2 becomes a lookup table.
 *
 * The prose for both lives in `docs/exercises/module-2-analog.md`.
 */

import type { Exercise } from '../exercises';
import { PART_STEP, PART_X, PART_Y, part } from './shared';


/* ------------------------------------------------------------------ *
 * 2.1 -- Precision Light Dimmer & Potentiometer Sampling
 * ------------------------------------------------------------------ */

const PRECISION_DIMMER: Exercise = {
  id: '2.1',
  title: 'Precision Light Dimmer & Potentiometer Sampling',
  level: 3,
  module: 'Module 2 — Analog Interfaces & Signals',
  difficulty: 'Intermediate',
  minutes: '45–60 mins',
  brief:
    'A potentiometer is the one control a person can use without thinking, and the one that teaches ' +
    'you most: it hands the ADC a voltage that means something, and somewhere between that voltage ' +
    'and the brightness of a lamp sits a number. You are building the dimmer, and the whole exercise ' +
    'is the rescaling — 1024 counts of knob travel onto 256 steps of brightness — done properly, so ' +
    'the fade looks even rather than lurching at one end.',
  concepts: [
    'analogRead hands back a count between 0 and 1023, not a voltage',
    'A potentiometer is a voltage divider with a slider between the two ends',
    'map() rescales one range of numbers onto another',
    'PWM sets an average voltage, not a smaller current',
  ],
  parts: [
    {
      name: 'Slide Potentiometer',
      qty: 1,
      why: 'The knob. Its two ends go across the rails and its wiper goes to the ADC pin.',
    },
    { name: 'Red LED', qty: 1, why: 'The light being dimmed. One channel is enough to see the curve.' },
    { name: '220 Resistor', qty: 1, why: 'Limits the LED current. Still not optional.' },
  ],
  wiring: [
    { pin: '5V', part: 'Slide Potentiometer', terminal: 'endA', goesTo: 'the red + rail' },
    { pin: 'GND', part: 'Slide Potentiometer', terminal: 'endB', goesTo: 'the blue − rail' },
    { pin: 'A0', part: 'Slide Potentiometer', terminal: 'wiper', goesTo: "A0's row — the wiper, not either end" },
    { pin: 'D3', part: '220 Resistor', terminal: 'b', goesTo: "D3's row" },
    { pin: 'D3', part: 'Red LED', terminal: 'anode', goesTo: 'the other leg of that resistor' },
    { pin: 'GND', part: 'Red LED', terminal: 'cathode', goesTo: 'the blue − rail' },
  ],
  steps: [
    'Run the red + rail from the 5V pin and the blue − rail from GND. A rail runs the whole length of the board: one long connection, not a row of them.',
    'Slide potentiometer: terminal 1 to the red + rail, terminal 3 to the blue − rail, terminal 2 — the wiper, the middle leg — to A0. Get 1 and 3 the right way round and the count runs backwards, which is a different fault from the one you are looking for.',
    'Red LED: long leg (the anode) to a 220 Ω resistor, the short leg (the cathode) to the blue − rail, and the other leg of the resistor to D3. The pin sources the current here, so a bigger duty really is brighter — wire the anode to the rail instead and the duty counts the wrong way round.',
    'Meter D3 against GND before you run anything. Hard over to one end it should sit near 0 V, hard over to the other near 5 V. If it does not move, the problem is the pot, not the sketch.',
    'Put the sketch in the editor, open the Serial monitor at 9600 baud, and push the slider slowly from end to end while watching all three printed columns.',
    'Probe D3 on the scope as you do. A 490 Hz square wave appears whose average voltage tracks the duty: about 1.0 V when the printed duty reads 51.',
  ],
  sketch: `#include <Arduino.h>

/*
 * Module 2 twin for 2.1 -- one pot on A0, one PWM channel on D3.
 *
 * Three dialect facts this sketch is built around:
 *   - there are no A0..A5 aliases, so A0 is named as the GPIO it actually is
 *     (14 on the ATmega328P; A1..A5 are 15..19);
 *   - constants are plain globals rather than "const byte", because the
 *     parser rejects const at file scope;
 *   - D3 is one of the six pins the hardware can do PWM on (3, 5, 6, 9, 10,
 *     11). Anywhere else analogWrite does nothing at all.
 */

byte KNOB_PIN = 14;      /* A0 */
byte LED_PIN = 3;        /* OC2A. Not every pin can do this. */

/* The measured ends of this pot's travel. A real 10k pot rarely reaches 0
   and 1023, and mapping the full code range means the extremes of the knob
   are unreachable -- map() truncates, so only CAL_MAX exactly reaches 255. */
int CAL_MIN = 30;
int CAL_MAX = 995;

/* 100 Hz sampling. One conversion is 104 us, so this costs about 1% of the
   loop. Five times a second is plenty to print. */
unsigned long SAMPLE_MS = 10;
unsigned long REPORT_MS = 200;

/* Raw counts sitting at an end stop for this long mean a detached wiper,
   not a dim setting. */
unsigned long FAULT_MS = 1000;

/* A four-sample moving average. Adding the new sample and subtracting the
   one it displaces keeps the mean exact and costs nothing per pass. */
int window[4];
int sum = 0;
int windex = 0;

int raw = 0;
int filtered = 0;
int duty = 0;
bool fault = false;

unsigned long lastSample = 0;
unsigned long lastReport = 0;
unsigned long stuckSince = 0;

void setup() {
  Serial.begin(9600);
  pinMode(LED_PIN, OUTPUT);
  analogWrite(LED_PIN, 0);

  /* The first conversion after the ADC is enabled is allowed 114 us rather
     than the usual 104 us and can read a few counts low, so prime the window
     with real readings rather than with zeros. */
  for (int i = 0; i < 4; i = i + 1) window[i] = analogRead(KNOB_PIN);
  sum = window[0] + window[1] + window[2] + window[3];
}

void loop() {
  unsigned long now = millis();

  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    raw = analogRead(KNOB_PIN);

    /* Add what just came in, subtract what it displaces. This is the same
       mean as summing all four each time, for a quarter of the work. */
    sum = sum + raw - window[windex];
    window[windex] = raw;
    windex = (windex + 1) % 4;
    filtered = sum / 4;

    /* An ADC pin with nothing on it settles wherever its leakage lets it and
       stays there. So a count pinned at either end for a second is a
       detached wiper, and saying "off" is better than pretending it is a
       dim setting. */
    if (raw <= 2 || raw >= 1021) {
      if (stuckSince == 0) stuckSince = now;
      if (now - stuckSince >= FAULT_MS) fault = true;
    } else {
      stuckSince = 0;
      fault = false;
    }
  }

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;

    if (fault) {
      duty = 0;
    } else {
      /* The whole exercise, in one line: the knob's counts onto the PWM's
         256 steps. This twin's map() is floating point, so ask it for
         hundredths and divide them off -- analogWrite wants a whole byte. */
      duty = map(filtered, CAL_MIN, CAL_MAX, 0, 25500) / 100;
    }

    /* map() happily returns a number outside the range you asked for when the
       input is outside the range you gave it, so clamp afterwards. */
    duty = constrain(duty, 0, 255);
    analogWrite(LED_PIN, duty);

    Serial.print(raw);       Serial.print("\t");
    Serial.print(filtered);  Serial.print("\t");
    Serial.println(duty);
  }
}
`,
  fault: {
    break_:
      'In the loop, change the map range from 0–25500 to 0–102300, so the ADC counts go straight to ' +
      'analogWrite without being rescaled to the PWM\'s scale.',
    teaches:
      'Every count above 255 lands outside the PWM\'s range once it is divided back down, so the ' +
      'top half of the knob\'s travel produces the same brightness as the knob at three-quarters. It ' +
      'looks like a dimmer with a dead zone, and the obvious suspicion is the pot. It is the ' +
      'mismatch between the ADC\'s 1024 counts and the PWM\'s 256: two different scales, and the job ' +
      'of map() is to be the translation between them.',
  },
  hints: [
    {
      when: 'The LED stops at about half brightness however far I push the slider.',
      answer:
        'The pot is across the wrong two terminals — most often a wiper on the supply and an end ' +
        'on A0, so the pin only ever sees half the divider. Meter the wiper against GND in ' +
        'resistance mode and it should sweep smoothly from 0 to 10 kΩ. If it only sweeps to about ' +
        '5 kΩ, two of the three legs are on the same rail and the third is doing all the work.',
    },
    {
      when: 'Nothing lights at all, and the Serial monitor prints a count that barely moves.',
      answer:
        'Almost always the wiper: something else is on A0, or A0 is on an end of the pot and the ' +
        'wiper is floating. A floating ADC input wanders across a fraction of a volt and then ' +
        'settles wherever its leakage lets it, which is exactly what a barely-moving count looks ' +
        'like. Check the wiper is the leg on the pin.',
    },
    {
      when: 'The brightness moves in visible steps as I turn it, and shimmers.',
      answer:
        'You are looking at the real resolution of both ends of the chain. The ADC\'s 1024 counts ' +
        'step one at a time as the knob crosses them, and the PWM\'s 256 steps each move the ' +
        'average current by 0.39%, which the eye can find on a bare LED much more easily than on ' +
        'a diffused one. Widen the window to 8 and watch the filtered column while the raw one ' +
        'still jumps. Flicker you can also hear at 490 Hz is the same thing arriving at your ear.',
    },
    {
      when: 'The duty column reads 255 and the LED is still dark.',
      answer:
        'The LED is wired the other way round: its anode is on the 5 V rail, so the pin has to be ' +
        'LOW to light it and your duty is being counted backwards. Either move the anode to the ' +
        'resistor and the cathode to GND, as the steps say, or write 255 - duty instead. Both work; ' +
        'they are just opposite signs of the same circuit, and worth knowing which one you built.',
    },
  ],
  references: [
    {
      term: 'Ten bits over five volts',
      what:
        'analogRead returns an integer from 0 to 1023, so one count is 5000 mV / 1024 = 4.88 mV. ' +
        'That is the size of the smallest change in the world this pin can report: a thermistor or ' +
        'a 10 kΩ pot cannot be measured more finely than that, no matter how carefully it is wired. ' +
        'The ATmega328P datasheet also guarantees only ±2 counts of accuracy, so a sensor sitting ' +
        'perfectly still still jitters by a count or two. Divide by 1023.0 rather than 1024.0 if ' +
        'you want the top code to mean exactly 5 V.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/analog/analogRead/',
    },
    {
      term: 'map()',
      what:
        'map(x, inMin, inMax, outMin, outMax) rescales one range onto another. On the Uno it is ' +
        'exactly (x − inMin) × (outMax − outMin) / (inMax − inMin) + outMin in integer arithmetic, ' +
        'so it truncates rather than rounds: 0–1023 onto 0–255 only reaches 255 at exactly 1023. ' +
        'It does not clamp either — an input below the range you supplied comes out below the output ' +
        'range, which is why the sketch runs the result through constrain() before writing it to a ' +
        'pin. The simulator\'s map() is the same formula in floating point, so the twin asks for ' +
        'hundredths and divides them off before handing a byte to analogWrite.',
    },
    {
      term: 'PWM duty cycle, and why half duty is not half brightness',
      what:
        'analogWrite(pin, d) holds the pin at the supply voltage for d/256 of each period and at 0 V ' +
        'for the rest, so the average is d/256 of 5 V. An LED responds to average current, so this ' +
        'is the right thing to be doing. What is not linear is the eye: perceived brightness goes as ' +
        'roughly the 2.2 power of radiant flux, so a duty of 127 looks about a quarter as bright as ' +
        '255, and a linear sweep lurches at one end and crawls at the other. Correcting it is one ' +
        'power operation — d = knob^2.2 × 255 — which is the first thing to reach for once the ' +
        'mapping itself is right.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/analog/analogWrite/',
    },
    {
      term: 'Which pins can do PWM, and why 490 Hz',
      what:
        'Only the six pins the hardware timers drive: D3, D5, D6, D9, D10 and D11. analogWrite on ' +
        'anything else compiles and does nothing, which is the single most common way to get a dead ' +
        'LED. The default frequency is the timer clock of 31250 Hz divided by 64, so 488.3 Hz — close ' +
        'enough to be called 490 — and it sits inside the band of hearing, which is why a dim ' +
        'channel hisses faintly. The channels are not all on one timer: D3/D11 share Timer2, D5/D6 ' +
        'share Timer0, D9/D10 share Timer1.',
    },
    {
      term: 'A potentiometer is a divider with a slider in the middle',
      what:
        'A resistive track with a fixed total resistance between its two ends, and a wiper that taps ' +
        'somewhere along it. Wire end A to 5 V, end B to GND and the wiper to the ADC pin, and you ' +
        'have two resistors in series whose split the knob moves: the wiper sits at 0 V at one end ' +
        'of travel and 5 V at the other. The ADC pin draws essentially no current, so no drop appears ' +
        'in the wiper and the count really is the knob position. What the ADC does dislike is the ' +
        'impedance it sees: 5 kΩ at mid-travel is fine, and a 100 kΩ pot at 25 kΩ is past the rule ' +
        'of thumb.',
    },
  ],
  writeUp: 'docs/exercises/module-2-analog.md',
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    const adc = simulation.boardTerminal('A0');
    const pwm = simulation.boardTerminal('D3');
    if (!supply || !ground || !adc || !pwm) return;

    const pot = simulation.addPart(part('Slide Potentiometer'), PART_X, PART_Y);
    const endA = simulation.pinAt(pot, 'endA');
    const endB = simulation.pinAt(pot, 'endB');
    const wiper = simulation.pinAt(pot, 'wiper');
    if (!endA || !endB || !wiper) return;
    simulation.routeWire(supply, endA);
    simulation.routeWire(endB, ground);
    simulation.routeWire(wiper, adc);

    const led = simulation.addPart(part('Red LED'), PART_X, PART_Y + PART_STEP);
    const anode = simulation.pinAt(led, 'anode');
    const cathode = simulation.pinAt(led, 'cathode');
    if (!anode || !cathode) return;
    simulation.routeWire(cathode, ground);

    const resistor = simulation.addPart(part('220 Resistor'), PART_X + 62, PART_Y + PART_STEP);
    const legA = simulation.pinAt(resistor, 'a');
    const legB = simulation.pinAt(resistor, 'b');
    if (!legA || !legB) return;
    simulation.routeWire(anode, legA);
    simulation.routeWire(legB, pwm);
  },
};


/* ------------------------------------------------------------------ *
 * 2.2 -- Analog Sensor Calibration & Voltage Dividers
 * ------------------------------------------------------------------ */

const SENSOR_CALIBRATION: Exercise = {
  id: '2.2',
  title: 'Analog Sensor Calibration & Voltage Dividers',
  level: 3,
  module: 'Module 2 — Analog Interfaces & Signals',
  difficulty: 'Intermediate',
  minutes: '75–90 mins',
  brief:
    'A sensor board does not hand you a temperature or a light level; it hands you a voltage, and ' +
    'converting that into a number worth logging is most of the job. You are wiring two analogue ' +
    'modules — a thermistor and a photoresistor — reading them, and putting a filter and a ' +
    'calibration check between the pin and the answer, which is what turns a twitching count ' +
    'into a series you would actually plot.',
  concepts: [
    'A resistive sensor becomes a voltage through a divider',
    'R_s = R_f (Vcc / V − 1) turns a count back into ohms',
    'A moving average smooths noise and buys lag',
    'One reference point checks the divider; two would recover gain as well',
  ],
  parts: [
    {
      name: 'Thermistor (NTC) Module',
      qty: 1,
      why: 'Temperature, as a divider. Its bead resistance falls as it warms, so the output rises.',
    },
    {
      name: 'Photoresistor (LDR) Module',
      qty: 1,
      why: 'Light, as a divider — the other way round, which is the interesting part.',
    },
  ],
  wiring: [
    { pin: '5V', part: 'Thermistor (NTC) Module', terminal: 'VCC', goesTo: 'the red + rail' },
    { pin: 'GND', part: 'Thermistor (NTC) Module', terminal: 'GND', goesTo: 'the blue − rail' },
    { pin: 'A0', part: 'Thermistor (NTC) Module', terminal: 'OUT', goesTo: "A0's row — the analogue output, not the knob" },
    { pin: '5V', part: 'Photoresistor (LDR) Module', terminal: 'VCC', goesTo: 'the red + rail' },
    { pin: 'GND', part: 'Photoresistor (LDR) Module', terminal: 'GND', goesTo: 'the blue − rail' },
    { pin: 'A1', part: 'Photoresistor (LDR) Module', terminal: 'AO', goesTo: "A1's row — AO, not DO" },
  ],
  steps: [
    'Run the red + rail from the 5V pin and the blue − rail from GND. Both modules take their supply from the board; neither will answer without it.',
    'Thermistor module: VCC to the red rail, GND to the blue rail, OUT to A0. Leave the little trimmer alone for now — the calibration check in this exercise assumes the divider is the one the module ships with.',
    'Photoresistor module: VCC to the red rail, GND to the blue rail, AO to A1. Wire AO and not DO: DO is the on-board comparator\'s output, and it can only ever be HIGH or LOW, so a sketch reading it with analogRead gets a number that means nothing.',
    'Do not rebuild the divider on the breadboard. Each module already is one — a sensor leg on top, a 10 kΩ below it — which is why both need only three wires.',
    'Meter A0 against GND with the thermistor knob at 25 °C. It must read almost exactly 2.5 V, because at 25 °C the bead and the fixed resistor are both 10 kΩ. That single number is the whole calibration check: if the sketch says 25 °C and the meter says anything else, the divider is not what the maths assumes.',
    'Set the thermistor knob to 25 °C, run the sketch, and open the Serial monitor at 9600 baud. The header prints once and then one CSV row every 500 ms, with the unfiltered count beside the temperature so you can check the maths rather than trust it: at 25 °C that count must read 512.',
    'Turn the thermistor knob up. The temperature column follows, always a little behind — that gap is the filter\'s group lag, and it is worth measuring rather than guessing at.',
    'Cover the LDR with your hand and watch both light columns. The raw count and the percentage move the same way, and the percentage is the one you would put in a log.',
  ],
  sketch: `#include <Arduino.h>

/*
 * Module 2 twin for 2.2 -- an NTC module on A0, an LDR module on A1.
 *
 * Two dialect facts this sketch is built around:
 *   - there is no log(), so the thermistor's beta curve is a lookup table.
 *     The table below was generated from
 *       T = (1/298.15 + ln(R/10000)/3950)^-1 - 273.15
 *     for a bead on top and a 10k fixed resistor below it, and covers 0..80 C
 *     with a worst-case interpolation error of 0.8 C, all of it high. That is
 *     why the fault limit below trips at 79.7 rather than at 80.0.
 *   - "/" truncates toward zero even on floats, so temperatures are carried
 *     round as tenths of a degree and printed by hand.
 */


byte TEMP_PIN = 14;       /* A0 */
byte LIGHT_PIN = 15;      /* A1 */

/* 100 Hz sampling, 2 Hz reporting. At 9600 baud one row is about 23 ms of
   transmit, which would not fit inside the 10 ms sample path anyway. */
unsigned long SAMPLE_MS = 10;
unsigned long REPORT_MS = 500;

/* ADC counts at the thermistor node, and the temperature in tenths of a
   degree C at each of those counts. 25 C lands between 480 and 528, so 512
   is the number to check the table against. */
int lutCounts[17] = { 192, 240, 288, 336, 384, 432, 480, 528, 576,
                      624, 672, 720, 768, 816, 864, 912, 960 };
int lutTenths[17] = { -47, 6, 53, 97, 140, 181, 223, 265, 308,
                      354, 404, 458, 521, 594, 687, 814, 1022 };

/* The moving average, eight samples deep. A mean of N cuts random noise by
   the square root of N and lags a real change by about N/2 samples, so eight
   is the cheap half of that trade. The divisor has to match this number. */
int window[8];
int sum = 0;
int windex = 0;

/* The two channels as they came off the pins this pass, before any of that. */
int rawTemp = 0;
int rawLight = 0;
int tenths = 250;

bool fault = false;
bool latched = false;

unsigned long lastSample = 0;
unsigned long lastReport = 0;

int lutLookup(int c) {
  /* Clamped, linearly interpolated. */
  if (c <= lutCounts[0]) return lutTenths[0];
  int i = 0;
  while (i < 15 && c > lutCounts[i + 1]) i = i + 1;
  int x0 = lutCounts[i];
  int y0 = lutTenths[i];
  int x1 = lutCounts[i + 1];
  int y1 = lutTenths[i + 1];
  /* Adding half the step before dividing by twice the step is the rounding. */
  return y0 + ((y1 - y0) * (c - x0) * 2 + (x1 - x0)) / ((x1 - x0) * 2);
}

void setup() {
  Serial.begin(9600);
  Serial.println("ms,temp_c,raw_t,lux_raw,light_pct");

  /* Start the window at 25 C rather than at zero, or the first half second is
     spent climbing out of a reading that was never taken. */
  for (int i = 0; i < 8; i = i + 1) window[i] = 250;
  sum = 250 * 8;
}

void loop() {
  unsigned long now = millis();

  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    rawTemp = analogRead(TEMP_PIN);
    rawLight = analogRead(LIGHT_PIN);

    tenths = lutLookup(rawTemp);

    /* Add what just came in, subtract what it displaces. */
    sum = sum + tenths - window[windex];
    window[windex] = tenths;
    windex = (windex + 1) % 8;
  }

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;

    int shown = sum / 8;

    /* Outside 0..80 C is a wiring fault or a dead sensor, not weather. Latch
       it and say it once, so the CSV stays something you can load. */
    if (shown < 0 || shown > 800) fault = true;
    else fault = false;

    /* The table's lowest entry is -4.7 C, so a negative result is possible
       and is not something to print as -4. */
    if (shown < 0) shown = 0;

    Serial.print(now);        Serial.print(",");
    Serial.print(shown / 10); Serial.print(".");
    /* The digit after the point: the tenths left over once the whole
       degrees have been taken off. */
    Serial.print(shown - (shown / 10) * 10);  Serial.print(",");
    /* The unfiltered count, printed beside the temperature on purpose. At
       25 C it must read 512, and that one number checks the whole divider
       without anyone having to trust the maths. */
    Serial.print(rawTemp);     Serial.print(",");
    Serial.print(rawLight);    Serial.print(",");
    /* 50k dark maps to about 171 counts and 3.5k bright to about 758,
       through the module's own 10k. A photoresistor needs the range the
       other way up from the resistance it falls to. Hundredths again, so the
       column is a whole percentage. */
    Serial.println(map(rawLight, 171, 758, 0, 10000) / 100);

    if (fault == true && latched == false) {
      latched = true;
      Serial.println("SENSOR FAULT: temp outside 0..80 C");
    } else if (fault == false && latched == true) {
      latched = false;
      Serial.println("SENSOR FAULT cleared");
    }
  }
}
`,
  fault: {
    break_:
      'In the report block, change the mean from sum / 8 to sum / 9 — one count too many, and the ' +
      'kind of arithmetic that is easy to make and harder to see.',
    teaches:
      'Every reading comes out about 11% low, and it comes out consistently low, so it looks like ' +
      'plausible weather rather than like an error. The divisor is not decorative: it is the size of ' +
      'the window, and it is the one number that ties the answer to how many samples went into it. ' +
      'Widen the window to 16 and you have to change the divisor with it — which is why a running ' +
      'sum is worth keeping alongside the array it came from.',
  },
  hints: [
    {
      when: 'The temperature is plausible but jumps a count or two, and the light figure twitches when I move my hand near the board.',
      answer:
        'Nothing is filtering: every reading goes straight to Serial. Push each channel through a ' +
        'moving average — keep the last eight samples, add the new one, subtract the one it ' +
        'displaces, and divide by eight. Random noise falls by the square root of the window, so ' +
        'eight samples is 2.8 times quieter than one. The catch is in the next hint.',
    },
    {
      when: 'The reading sits at 0, or sits at 1023, and never moves at all.',
      answer:
        'Either the module is not powered — check VCC is on the red rail and GND on the blue one — ' +
        'or you have wired DO where AO belongs. DO is the on-board comparator\'s output and can only ' +
        'be HIGH or LOW, so analogRead on it returns a number that looks like a reading and is not ' +
        'one. Both modules are three-wire: VCC, GND, and the analogue output.',
    },
    {
      when: 'The filtered temperature is always behind the real one.',
      answer:
        'That is the price of the filter, and it is arithmetic rather than a bug: a moving average ' +
        'of N samples lags a real step by about N/2 samples, so eight samples at 100 Hz costs you ' +
        '40 ms — invisible here. If the lag is a whole second, the window is much longer than it ' +
        'looks: check you are pushing one sample per pass rather than eight, and that the divisor ' +
        'matches the window. Note what a mean does to a single spike: it smears it across all N ' +
        'samples and never removes it. A median throws spikes away outright.',
    },
    {
      when: 'Every temperature reads about four or five degrees too warm, and no amount of calibration helps.',
      answer:
        'Search the sketch for analogReference. A single analogReference(INTERNAL) re-bases the ' +
        'ADC onto the internal 1.1 V bandgap, so the 512 counts that meant 2.5 V now mean 1.1 V, ' +
        'and every volts-to-ohms conversion downstream is wrong by a factor of 5.0/1.1 = 4.55. That ' +
        'is a change of slope rather than of offset, and one reference point cannot correct a slope ' +
        '— which is exactly the trap.',
    },
  ],
  references: [
    {
      term: 'Voltage dividers, and where they are genuinely needed',
      what:
        'Two resistors in series across a supply, with the pin tapped between them: ' +
        'Vout = Vin × R2 / (R1 + R2). That is the whole idea, and a resistive sensor is just R1 ' +
        'with a moving value. You do not need one when the thing you are measuring already produces ' +
        'a voltage — a sensor board with an output amplifier has done the divider for you, and both ' +
        'modules here are exactly that: a bead or a photoresistor on top, a 10 kΩ below it. You ' +
        'build your own only when you have a bare resistive element and no board to put it on. What ' +
        'the divider always does decide is the impedance the ADC pin sees, which is half of R1 plus ' +
        'half of R2 — keep that under about 10 kΩ or put a capacitor on the node.',
    },
    {
      term: 'Inverting the divider to get back to ohms',
      what:
        'Sensor on top, fixed resistor below, the node on the ADC: V = Vcc × R_f / (R_f + R_s), so ' +
        'the node falls as the sensor\'s resistance rises. Rearranged, Rs = R_f × (Vcc / V − 1). The ' +
        'useful consequence is the calibration anchor: at 25 °C a 10 kΩ bead and a 10 kΩ resistor ' +
        'are equal, so the node sits at exactly 2.5 V, which is count 512. If your sketch says ' +
        '25 °C and your meter says anything but 2.5 V, one of the two is wrong and you have not got ' +
        'to look at the maths yet.',
    },
    {
      term: 'The NTC thermistor and its beta constant',
      what:
        'An NTC thermistor\'s resistance falls as it warms, which is why this one is wired with the ' +
        'bead on top and the reading rises with temperature. The curve is not linear; it is ' +
        'described by one number called beta: T = (1/T0 + ln(R/R0) / beta)^-1 − 273.15, with R0 = ' +
        '10 kΩ at T0 = 298.15 K for the usual bead, and beta = 3950 K for the common type. Because ' +
        'beta is quoted to ±5% on a no-name part, a bead that is nominally right can still be two ' +
        'degrees out at 60 °C. That is six times worse than the tolerance of the 10 kΩ resistor ' +
        'beside it, and no amount of averaging removes either.',
    },
    {
      term: 'constrain()',
      what:
        'constrain(x, low, high) holds a value between two bounds, and is the simplest thing in the ' +
        'language. It earns its place here because map() is not safe on its own: map() returns ' +
        'whatever the arithmetic gives it, so a value below the input range you supplied comes out ' +
        'below the output range, and writing that to analogWrite hands the PWM a number it cannot ' +
        'use. Map first, clamp second.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/math/constrain/',
    },
    {
      term: 'Sampling rate versus smoothing',
      what:
        'Sampling fast and averaging hard are the same decision viewed from two ends, and you cannot ' +
        'maximise both. A moving average of N samples cuts random noise by the square root of N — ' +
        'eight samples is 2.8 times quieter — but it lags a real change by about N/2 samples, and it ' +
        'smears a single spike across all N of them without ever removing it. A median of N does the ' +
        'opposite: it kills one-sample outliers outright, at no cost to a real step. Pick the ' +
        'average for quantisation noise on a slow-changing quantity, the median for impulsive ' +
        'disturbance like a relay click, and both — median first, then a mean — when the disturbance ' +
        'is a spike sitting on top of noise.',
    },
  ],
  writeUp: 'docs/exercises/module-2-analog.md',
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    const tempAdc = simulation.boardTerminal('A0');
    const lightAdc = simulation.boardTerminal('A1');
    if (!supply || !ground || !tempAdc || !lightAdc) return;

    // Both modules already carry their own divider, so each one is three
    // wires and nothing more. The thermistor sits above its fixed resistor
    // and the photoresistor below its own, which is why the two channels run
    // in opposite directions and both still read usefully.
    const thermistor = simulation.addPart(part('Thermistor (NTC) Module'), PART_X, PART_Y);
    const ntcVcc = simulation.pinAt(thermistor, 'VCC');
    const ntcGnd = simulation.pinAt(thermistor, 'GND');
    const ntcOut = simulation.pinAt(thermistor, 'OUT');
    if (!ntcVcc || !ntcGnd || !ntcOut) return;
    simulation.routeWire(supply, ntcVcc);
    simulation.routeWire(ntcGnd, ground);
    simulation.routeWire(ntcOut, tempAdc);

    const photoresistor = simulation.addPart(
      part('Photoresistor (LDR) Module'),
      PART_X,
      PART_Y + PART_STEP,
    );
    const ldrVcc = simulation.pinAt(photoresistor, 'VCC');
    const ldrGnd = simulation.pinAt(photoresistor, 'GND');
    const ldrAnalog = simulation.pinAt(photoresistor, 'AO');
    if (!ldrVcc || !ldrGnd || !ldrAnalog) return;
    simulation.routeWire(supply, ldrVcc);
    simulation.routeWire(ldrGnd, ground);
    // AO and not DO: DO is the on-board comparator's output, HIGH or LOW only.
    simulation.routeWire(ldrAnalog, lightAdc);
  },
};

/**
 * Module 2, in the order they are meant to be worked.
 *
 * Concatenated into `EXERCISES` by whoever owns that array; this file exports
 * nothing else.
 */
export const MODULE_2: readonly Exercise[] = [PRECISION_DIMMER, SENSOR_CALIBRATION];