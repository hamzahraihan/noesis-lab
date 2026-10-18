/**
 * Module 5 — Networks.
 *
 * The one lesson where the interesting wiring is the one you cannot see: the
 * board's radio and the network beyond it. 5.1 already fetched map tiles
 * without naming the network; this lesson names it, and teaches the shape a
 * program needs once answers arrive on their own schedule.
 */

import type { Exercise } from '../exercises';
import { CIRCUITS } from '../circuits';

/**
 * The desk: the network's clock and its sensor, on one panel, in one loop.
 *
 * Two jobs in one `loop()` is the whole exercise. The time is *asked for* and
 * the answer is checked on later passes -- a flag, not a wait. The temperature
 * is *sent* whether or not anyone is listening, and is picked up whenever it
 * arrives. Neither one may stop the other, which is why there is no `delay()`
 * in the loop and no `while` spinning on the network.
 */
const NETWORK_DESK_SKETCH = `#include <WiFi.h>

#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREEN 0x07E0
#define SKY   0x867D

/* How often the time is asked for, in milliseconds. */
#define ASK_EVERY_MS 5000

int waiting = 0;
unsigned long lastAsk = 0;

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(1);
  tft.clear();
  tft.print("NETWORK DESK", 20, 20, SKY);

  /*
   * Joining is the one thing worth waiting for, and setup has nothing else to
   * do. Poll the status; a network that refuses looks like a loop that never
   * ends, which is itself the lesson.
   */
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(50);
  }
  Serial.print("ip ");
  Serial.println(WiFi.localIP());
  tft.print(WiFi.localIP(), 20, 50, WHITE);

  /* Subscribe once; the readings arrive on their own from here. */
  Serial.print("subscribed ");
  Serial.println(net.subscribe("readings/temp"));

  /*
   * Start the first request and do NOT wait for it. The flag is the whole
   * trick: the answer is not here yet, and the loop has other work.
   */
  net.get("http://api.noesis/time");
  waiting = 1;
  lastAsk = millis();
}

void loop() {
  /* 1. Whatever the network sent, show it. Asking costs nothing. */
  if (net.available()) {
    tft.fillRect(20, 200, 440, 40, BLACK);
    tft.print(net.message(), 20, 200, GREEN);
    Serial.print("temp ");
    Serial.println(net.message());
  }

  /* 2. Is the answer to the clock request in? Check, do not wait. */
  if (waiting == 1 && net.get("http://api.noesis/time") == 1) {
    waiting = 0;
    tft.fillRect(20, 120, 440, 40, BLACK);
    if (net.failed()) {
      Serial.println("no answer");
      tft.print("no answer", 20, 120, 0xF800);
    } else {
      Serial.print("time ");
      Serial.println(net.read());
      tft.print(net.read(), 20, 120, WHITE);
    }
  }

  /* 3. Five seconds since the last ask: start the next one, and no more. */
  if (waiting == 0 && millis() - lastAsk >= ASK_EVERY_MS) {
    /*
     * A new request, not the old answer: without reset the port would hand
     * back the time it already has and the clock would stand still.
     */
    net.reset();
    net.get("http://api.noesis/time");
    waiting = 1;
    lastAsk = millis();
  }
}
`;

const NETWORK_DESK: Exercise = {
  id: '5.3',
  title: 'A network desk: ask, listen, never wait',
  level: 5,
  module: 'Module 5 — Networks',
  difficulty: 'Intermediate',
  minutes: '60–75 mins',
  brief:
    'The board joins a network and keeps a desk on it: it asks the network for the time every five seconds and listens for a temperature sensor that publishes on its own. Neither answer arrives when it is asked for, so the loop checks instead of waiting — and the panel keeps up with both.',
  concepts: [
    'An answer arrives later: a request is started, then checked on a later pass',
    'A name is a lookup, and a lookup can fail: every request settles as a body or a failure',
    'The network speaks first: a subscription delivers messages nobody asked for',
  ],
  parts: [
    {
      name: '3.2" TFT (ILI9341)',
      qty: 1,
      why: "It shows both halves of the program at once: the time that was asked for, and the temperature that simply arrived.",
    },
  ],
  board: 'esp32',
  wiring: [
    {
      pin: '3V3',
      part: '3.2" TFT (ILI9341)',
      terminal: 'VCC',
      goesTo: "the panel's supply — 3.3 V, because its logic is not 5 V tolerant",
    },
    {
      pin: 'GND',
      part: '3.2" TFT (ILI9341)',
      terminal: 'GND',
      goesTo: "the panel's ground, so both ends of the supply are defined",
    },
    {
      pin: 'D23',
      part: '3.2" TFT (ILI9341)',
      terminal: 'DIN',
      goesTo: "the panel's data input, on the board's SPI MOSI line",
    },
    {
      pin: 'D18',
      part: '3.2" TFT (ILI9341)',
      terminal: 'CLK',
      goesTo: "the panel's clock, on the board's SPI SCK line",
    },
    {
      pin: 'D5',
      part: '3.2" TFT (ILI9341)',
      terminal: 'CS',
      goesTo: "the panel's chip select, which is how it knows a byte is for it",
    },
    {
      pin: 'D15',
      part: '3.2" TFT (ILI9341)',
      terminal: 'D/C',
      goesTo: "the data-or-command line, which changes what the next byte means",
    },
  ],
  steps: [
    'Power the panel: 3V3 to VCC and GND to GND. Nothing else until both are in.',
    'Wire the bus: D18 to CLK, D23 to DIN, D5 to CS, D15 to D/C.',
    'Join the network and print the address it hands out, so you know the radio works before any program logic is involved.',
    'Start the clock request in setup without waiting for it, and keep a flag that says one is out.',
    'Check the flag and the answer on every pass; when it is in, draw it and clear the flag.',
    'Subscribe to the sensor, and print and draw each message as it arrives — on a pass where you were doing something else.',
    'Re-ask every five seconds using millis(), and never with a delay().',
  ],
  solution: {
    approach: [
      'The program has two jobs and one loop, so the loop must never block. That is the whole design: every wait becomes a check, and every check is cheap enough to run thousands of times a second.',
      'The clock is a request with a lifetime. Setup starts it and sets a flag; `net.get` on later passes answers whether it has finished, not what it says. When the flag is up and `net.get` reports 1, the body is read once, drawn, and the flag comes down. A `reset` before the next ask is what makes it a new request rather than the old answer read again.',
      'The temperature is the opposite shape: nobody asked. `net.available()` answers whether a subscribed message has arrived since the last look, and `net.message()` returns it. The same pass that checks the clock also checks the sensor, which is why one loop can carry both.',
      'Timing is `millis() - lastAsk >= ASK_EVERY_MS`, difference first. It survives the counter wrapping, and it never stops the loop to wait.',
    ],
    wiring: [
      {
        pin: '3V3',
        terminal: 'VCC',
        why: 'The panel is a 3.3 V part. On a 5 V board this header is the only correct supply, and the ESP32 has it.',
      },
      {
        pin: 'GND',
        terminal: 'GND',
        why: 'Supply and ground both have to be real. A panel with only power has no return path and stays dark.',
      },
      {
        pin: 'D23',
        terminal: 'DIN',
        why: 'This is the board SPI MOSI line. Data goes one way only, into the panel, which is why it is called DIN there.',
      },
      {
        pin: 'D18',
        terminal: 'CLK',
        why: 'The clock line paces every bit. On the ESP32 the SPI clock is on D18, and the panel latches on its edge.',
      },
      {
        pin: 'D5',
        terminal: 'CS',
        why: 'Chip select says this byte is for the panel. Without it a second device on the bus would take the data too.',
      },
      {
        pin: 'D15',
        terminal: 'D/C',
        why: 'Data or command: the same bus carries both, and this line is the only thing that distinguishes them.',
      },
    ],
    working: [
      'The serial monitor prints `ip 192.168.4.10` once the join lands.',
      'It prints `subscribed 1`, then a temperature every second — `temp 20.0`, `temp 20.5`, … — arriving while the loop is doing something else.',
      'Every five seconds it prints `time 2026-10-17T12:00:0xZ`, the network clock rather than anything the board counted.',
      'The panel shows the address, then the time above the temperature, both updating without the loop ever stopping.',
    ],
    traps: [
      'Waiting on the answer with `while (net.get(...) == 0) { }` stops the loop, and with it the subscription. The temperature stops arriving at exactly the moment the clock is slow — the two bugs arrive together.',
      'Calling `net.get` again after an answer is complete, without `reset`, is not a new request: the port hands back the body it already has and the clock freezes at the first time it read.',
      'Assuming `1` means success. A name or a path the network does not serve also settles, as `failed()`; treating that as a body prints a blank line and looks like a dead sensor.',
      'Comparing `millis()` against a fixed deadline instead of a difference. It works until the counter wraps, then the clock stops asking for forty-nine days.',
    ],
  },
  sketch: NETWORK_DESK_SKETCH,
  fault: {
    break_:
      'Replace the flag with a blocking wait in loop(): `while (net.get("http://api.noesis/time") == 0) { }`.',
    teaches:
      'The moment the loop blocks, the temperature stops arriving — the subscription is still live and the sensor is still publishing, but nothing is reading. One job starving another is the failure this exercise exists to prevent.',
  },
  hints: [
    {
      when: 'The panel lights but the serial monitor never shows an address.',
      answer:
        'The join has not landed. `WiFi.status()` reads `WL_IDLE_STATUS` until it does; keep polling it in setup, where waiting is allowed because there is nothing else to do yet.',
    },
    {
      when: 'The temperature prints once and then the board goes quiet.',
      answer:
        'Something in the loop is waiting. `net.get` does not wait — if the loop stopped, you probably wrote a `while` around it. Keep a flag and check on a later pass instead.',
    },
    {
      when: '`temp` arrives but `time` never does.',
      answer:
        'Check the order: the request is started in setup and checked in loop. If you never started it, or cleared the flag before reading `net.read()`, there is nothing to print.',
    },
    {
      when: 'The clock stays at the same second forever.',
      answer:
        'The request was never restarted. A port asked for the same url twice answers with the request it already completed; call `net.reset()` before asking again.',
    },
  ],
  references: [
    {
      term: 'The WiFi library: begin, status and localIP',
      what:
        'Arduino\'s reference for the calls this lesson starts with. Read it for the status codes — the join is a process with states, not a function that returns connected.',
      readMore: 'https://docs.arduino.cc/libraries/wifi/',
    },
    {
      term: 'Publish and subscribe, as a model',
      what:
        'MQTT is why a sensor can publish to nobody in particular and a subscriber can still receive it. The bench\'s `subscribe`/`available`/`message` is that model without the wire protocol.',
      readMore: 'https://mqtt.org/',
    },
    {
      term: 'HTTP: requests and responses',
      what:
        'The request/response shape the clock endpoint speaks. The part worth reading twice is that a response has a status, which is why a request can complete and still be a failure.',
      readMore: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview',
    },
    {
      term: 'millis(), and why the difference comes first',
      what:
        'The reference for the counter itself. The wrap-safe comparison — `now - last >= span` — is the idiom every non-blocking program here uses.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/time/millis/',
    },
  ],
  writeUp: 'docs/exercises/module-5-networks.md',
  circuit: CIRCUITS['esp32-tft'],
};

export const MODULE_5_NETWORKS: readonly Exercise[] = [NETWORK_DESK];
