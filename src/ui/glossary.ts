/**
 * The vocabulary an embedded course assumes you already have.
 *
 * Kept as data rather than as JSX so the same words can be reused by the
 * exercises without either side drifting, and so the reference page stays a
 * list of terms rather than a wall of markup.
 *
 * Every entry is written to be read by someone who has just met the word for
 * the first time and has no question to hang it on yet. That rules out the
 * dictionary definition: "pull-up: a resistor to VCC" teaches nothing to
 * someone who does not yet know why an input would float.
 */

export interface GlossaryEntry {
  readonly term: string;
  readonly what: string;
  readonly readMore?: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'pinMode(pin, INPUT / OUTPUT)',
    what:
      'Declares what a pin is for. Until you call it, every pin is an input. Writing to an input sets ' +
      'a tiny internal pull-up rather than driving the pin, which is the usual reason "I wrote HIGH ' +
      'and nothing happened".',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/digital/pinMode/',
  },
  {
    term: 'digitalRead / digitalWrite',
    what:
      'Read a pin as 0 or 1, or set it to 0V or the supply voltage. Two values only. Anything ' +
      'in between is an analog quantity and needs analogRead or analogWrite.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/digital/digitalRead/',
  },
  {
    term: 'HIGH and LOW',
    what:
      'HIGH is the supply voltage (5V on the Uno) and LOW is 0V. They are not "on" and "off" — they ' +
      'are voltages, and anything that cares about the difference between them is reading a voltage.',
  },
  {
    term: 'INPUT_PULLUP',
    what:
      'A pin declared INPUT_PULLUP reads HIGH when nothing is connected and LOW when something pulls ' +
      'it to ground. It flips the usual expectation: the button shorts the pin to ground, and the ' +
      'closed button is the LOW reading. No external resistor needed.',
  },
  {
    term: 'Pull-up and pull-down',
    what:
      'An input pin reads whatever the air decides if nothing drives it — a floating input picks up ' +
      'noise and can flip at random. A pull-up (to VCC) or pull-down (to GND) gives it a defined ' +
      'resting value. The Uno\'s internal ones are 20–50 kΩ and are switched off during reset.',
  },
  {
    term: 'Active-LOW',
    what:
      'A signal where LOW means "on", which is what an open-drain or open-collector output gives you: ' +
      'it pulls to ground and does nothing otherwise, so the pull-up supplies the HIGH. I²C is ' +
      'entirely active-LOW, which is why it needs pull-ups on the bus.',
  },
  {
    term: 'Debouncing',
    what:
      'A mechanical switch does not close cleanly. Its contacts bounce for a few milliseconds, so one ' +
      'press reads as several. Fix it in software by ignoring changes that arrive within about 20–50ms ' +
      'of the last one.',
  },
  {
    term: 'Non-blocking timing',
    what:
      'Getting time with millis() instead of delay(). delay() stops the program entirely, so the ' +
      'program cannot do anything else while it waits. `if (now - last >= INTERVAL)` lets everything ' +
      'else keep running between checks. Banned from Level 2 onward, and taught where it is needed.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/millis/',
  },
  {
    term: 'millis() / micros()',
    what:
      'Milliseconds and microseconds since the board started. Both keep counting while your code runs, ' +
      'which is what makes them the basis of every non-blocking timer. millis() wraps at about 49.7 ' +
      'days, which is why comparisons use unsigned subtraction.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/micros/',
  },
  {
    term: 'analogRead',
    what:
      'Reads a voltage on an analog pin and returns a number: 0–1023 on the Uno\'s 10-bit converter. ' +
      'The resolution is the limit — no amount of care gets you more than 1024 distinct readings.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/analog/analogRead/',
  },
  {
    term: 'PWM and analogWrite',
    what:
      'Pulse-width modulation: a pin is switched full-on and full-off very fast, and the *proportion* ' +
      'of time it is on sets the average. That is how a pin drives a dimmer LED. On the Uno, analogWrite ' +
      'takes 0–255 and runs at about 490 Hz.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/analog/analogWrite/',
  },
  {
    term: 'Duty cycle',
    what:
      'The fraction of the period a signal is high. 50% is half on. PWM brightness is duty cycle: ' +
      'analogWrite(pin, 128) is about 50%, which is roughly half the *current*, and human brightness ' +
      'perception makes that look like about a quarter as bright.',
  },
  {
    term: 'Voltage divider',
    what:
      'Two resistors in series between the supply and ground, with the signal taken from the point ' +
      'between them. It scales a voltage down: Vout = Vin × R2 / (R1 + R2). This is how you read a ' +
      '5V sensor on a 3.3V pin, and how you make a high resistance sensor readable at all.',
  },
  {
    term: 'Open-drain',
    what:
      'An output that can pull a line to ground or let it float, and never drives it high. The pull-up ' +
      'supplies the HIGH. Because no device ever drives the line high, several can share one wire ' +
      'without fighting — which is the whole trick behind I²C.',
  },
  {
    term: 'I²C (Wire)',
    what:
      'Two wires: SDA for data, SCL for the clock. Every device shares both, and each answers to its ' +
      'own 7-bit address, so a device is picked out by address rather than by a wire of its own. ' +
      'SDA and SCL are open-drain and need pull-up resistors — usually already fitted on the module.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/wire/',
  },
  {
    term: 'SPI',
    what:
      'Four wires — clock, master-out, master-in, chip-select — and it is much faster than I²C because ' +
      'it has a clock line of its own and each device gets its own select wire. Used by the SSD1306 in ' +
      'SPI mode and by the ILI9341 display.',
    readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/spi/',
  },
  {
    term: 'Chip select',
    what:
      'The wire that says "this device, now". Sharing a bus with one clock line only works because ' +
      'each device listens to its own select line. Forgetting to assert it is a common reason a SPI ' +
      'device is completely silent rather than slightly wrong.',
  },
  {
    term: 'Address',
    what:
      'The number a device answers to on a shared bus. An OLED is usually 0x3C, and some modules can ' +
      'be moved to 0x3D with a solder jumper. Two devices on one bus at the same address means neither ' +
      'is reachable.',
  },
  {
    term: 'Interrupt',
    what:
      'A pin change that makes the CPU stop what it is doing and run a function instead. It is how you ' +
      'notice a pulse too short for the main loop to ever poll for. The Uno has exactly two: D2 and D3.',
  },
  {
    term: 'volatile',
    what:
      'Tells the compiler that a variable can change behind its back, so it must re-read it every time ' +
      'rather than caching it in a register. Required for anything an interrupt handler touches.',
  },
  {
    term: 'ISR (interrupt service routine)',
    what:
      'The function an interrupt runs. It runs with the rest of the program suspended, so it must be ' +
      'short and it must not block: no delay(), no waiting on a serial buffer. That budget is the ' +
      'subject of Exercise 4.1.',
  },
  {
    term: 'Serial monitor',
    what:
      'A window showing the text your program prints. When a sketch does something you cannot see, ' +
      'printing the value that surprised you is usually faster than guessing. Note that D0 and D1 are ' +
      'the same wires as the serial link on the Uno.',
  },
  {
    term: 'const, #define, and why globals here',
    what:
      '#define LED_PIN 8 is textually replaced before compiling, which is why it cannot be given a ' +
      'type. const byte LED_PIN = 8 is a real typed variable. The twin sketches in this course use ' +
      'plain globals at file scope because the simulator\'s parser is deliberately small — the lesson ' +
      'in Module 1 is that idiomatic const is better, and the exercise says so.',
  },
];
