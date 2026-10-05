/**
 * Module 3 -- Serial Protocols & Hardware Bus Communication.
 *
 * The two exercises where the Uno stops being a set of pins and becomes a bus.
 * One is two wires and an address; the other is a clock shared by devices that
 * have to be told, one at a time, which of them the clock belongs to.
 *
 * Both sketches are written in the interpreter's dialect -- no `const` at file
 * scope, no `uint8_t`, no `String` -- and both use only what the bench really
 * does: `Wire.begin`/`beginTransmission`/`write`/`endTransmission` for the I²C
 * panel, `SPI.beginTransaction`/`transfer(value, dataSelect)`/`SPI.end` for the
 * SPI one, and `dht.temperature`/`dht.humidity` for the DHT22, which is a
 * single-wire sensor rather than a bus device and is read as one.
 *
 * The prose for both lives in `docs/exercises/module-3-bus-protocols.md`.
 */

import type { Exercise } from '../exercises';
import { PART_STEP, PART_X, PART_Y, part } from './shared';


/* ------------------------------------------------------------------ *
 * 3.1 -- I2C Environmental Monitor with OLED & Sensor
 * ------------------------------------------------------------------ */

const I2C_MONITOR: Exercise = {
  id: '3.1',
  title: 'I²C Environmental Monitor with OLED & Sensor',
  level: 4,
  module: 'Module 3 — Serial Protocols & Hardware Bus Communication',
  difficulty: 'Intermediate',
  minutes: '75–90 mins',
  brief:
    'A cold-chain logger clipped inside a vaccine transport case, reading the air it is protecting and ' +
    'showing the reading to whoever opens the lid. You are putting a temperature/humidity sensor and a ' +
    '128×64 display on one two-wire bus, where a device is not selected by a wire but by an address, ' +
    'and where the frame buffer you push to the panel wants 1024 bytes out of the 2048 the whole chip has.',
  concepts: [
    'Two wires, many devices, one address on each',
    'Open-drain: nobody drives HIGH, a pull-up does',
    'A control byte that separates commands from pixels',
    'A 1024-byte frame buffer in 2048 bytes of SRAM',
  ],
  parts: [
    { name: '128x64 OLED (SSD1306)', qty: 1, why: 'The bus’s first device, and it answers at 0x3C.' },
    { name: '10k Resistor', qty: 2, why: 'One pull-up per line. A bus with no pull-up has no HIGH on it.' },
    { name: 'DHT22 Temp/Humidity', qty: 1, why: 'The reading itself, on a data wire of its own.' },
  ],
  wiring: [
    { pin: 'A4', part: '128x64 OLED (SSD1306)', terminal: 'SDA', goesTo: 'the shared SDA net' },
    { pin: 'A5', part: '128x64 OLED (SSD1306)', terminal: 'SCL', goesTo: 'the shared SCL net' },
    { pin: '5V', part: '128x64 OLED (SSD1306)', terminal: 'VCC', goesTo: 'the 5 V rail — the charge pump needs it' },
    { pin: 'GND', part: '128x64 OLED (SSD1306)', terminal: 'GND', goesTo: 'the ground rail' },
    { pin: '5V', part: '10k Resistor', terminal: 'a', goesTo: 'the top of the SDA pull-up' },
    { pin: 'A4', part: '10k Resistor', terminal: 'b', goesTo: 'the shared SDA net' },
    { pin: '5V', part: '10k Resistor', terminal: 'a', goesTo: 'the top of the SCL pull-up' },
    { pin: 'A5', part: '10k Resistor', terminal: 'b', goesTo: 'the shared SCL net' },
    { pin: 'D2', part: 'DHT22 Temp/Humidity', terminal: 'SDA', goesTo: 'the sensor data line — one wire, not a bus' },
    { pin: '5V', part: 'DHT22 Temp/Humidity', terminal: 'VCC', goesTo: 'the 5 V rail' },
    { pin: 'GND', part: 'DHT22 Temp/Humidity', terminal: 'GND', goesTo: 'the ground rail' },
  ],
  steps: [
    'Join the 5 V and ground rails first, and power the board with nothing on the bus. With a meter on SDA-to-5 V, infinity means no pull-up exists anywhere yet, and a few kΩ means the module brought its own — fit the 10 kΩ pair only in the first case, because two pairs in parallel is 5 kΩ and twice the sink current for nothing.',
    'Wire the OLED: SDA to A4 and SCL to A5, VCC to 5 V, GND to the ground rail. SDA and SCL are not interchangeable, and A4/A5 are also the USB-serial lines, which is why the Serial monitor blanks for a second during every upload.',
    'Wire the DHT22: VCC to 5 V, GND to ground, and its one data wire to D2. That terminal is labelled SDA because the package is shared with other sensors, not because the part speaks I²C — a DHT22 is a single-wire device and joins no bus.',
    'Put the sketch in the editor and press Run. The setup scan walks 0x08 to 0x77 and every one of those transfers lands in the Bus Monitor; exactly one line should carry the acknowledged flag, at 0x3C.',
    'Read that acknowledged column rather than the return value of `endTransmission()`. The bench logs what the bus did, which is the fact; the sketch’s copy of it is a modelled approximation.',
    'Turn the DHT22’s temperature and humidity knobs on the part, or warm it with a fingertip on the bench, and watch the trend on the panel and the numbers on the Serial monitor.',
    'Count the transfers for one redraw in the Bus Monitor: sixteen, not 1024. One transaction points the panel at a page, the next delivers that page’s 128 bytes.',
  ],
  sketch: `#include <Arduino.h>
#include <Wire.h>

/*
 * Module 3 twin for 3.1 -- one two-wire bus, one display on it, and a sensor
 * that is honestly not on the bus at all.
 *
 * Two things this bench does not do, said plainly rather than faked:
 *   - The DHT22 is a single-wire sensor. The twin hands the climate to the
 *     sketch through dht.temperature()/humidity() rather than a byte stream,
 *     so what the Bus Monitor shows you here is the display's traffic only.
 *   - frame[] is a host array, so nothing here can run out of RAM. On the Uno
 *     it is 1024 bytes out of 2048, and that is the arithmetic this exercise
 *     is really about.
 */

#define OLED_ADDR 0x3C      // seven bits. The datasheet prints 0x78: 0x3C << 1.
#define SENSOR_PIN 2        // the DHT22's single data wire; nothing to do with SDA
#define W 128
#define PAGES 8
#define TREND_LEN 64        // one column per sample, oldest at the left
#define TREND_PAGES 4       // the bottom 32 pixels: pages 4..7
#define FRAME_MS 1000

/*
 * The sizes are written out rather than computed as W * PAGES and TREND_LEN:
 * the interpreter's parser wants a plain number between the brackets. On the
 * Uno the number is the whole point -- 1024 bytes out of 2048 -- so saying it
 * out loud costs nothing.
 */
byte frame[1024];
byte trend[64];
unsigned long lastFrame = 0;
int frames = 0;

/*
 * One command per transaction. The 0x00 in front of it is the control byte:
 * a single bit says whether what follows is a command or is pixel data, and
 * without it the panel reads your command bytes as columns.
 */
void oledCommand(int c) {
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}

void oledInit() {
  oledCommand(0xAE);                          // display off while it is configured

  // A command and its arguments share one transaction, because a new
  // transaction starts a new control byte and the argument would be read as
  // one. That is the whole framing rule of this bus.
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);
  Wire.write(0x21); Wire.write(0x00); Wire.write(W - 1);   // columns 0..127
  Wire.write(0x22); Wire.write(0x00); Wire.write(PAGES - 1);
  Wire.endTransmission();

  oledCommand(0x20); oledCommand(0x02);       // page addressing: write where told
  oledCommand(0x81); oledCommand(0xCF);       // contrast
  oledCommand(0xA1); oledCommand(0xC8);       // segment remap, scan direction
  oledCommand(0xDA); oledCommand(0x12);       // COM pins
  oledCommand(0x8D); oledCommand(0x14);       // charge pump on -- needs VCC at 5 V
  oledCommand(0xAF);                          // display on
}

/*
 * One page at a time: point the panel at the page, then hand it the 128
 * bytes. Sixteen transfers redraw the whole screen -- two per page, because
 * the addressing rides in a single transaction with one control byte in front
 * of it. A thousand round trips to say the same thing would not keep up with a
 * second redraw.
 */
void flushPage(int which) {
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);                          // commands from here on
  Wire.write(0xB0 | which);                  // page address
  Wire.write(0x00);                          // column low nibble
  Wire.write(0x10);                          // column high nibble -- column 0
  Wire.endTransmission();

  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x40);            // control byte: everything after this is pixels
  for (int x = 0; x < W; x++) { Wire.write(frame[which * W + x]); }
  Wire.endTransmission();
}

/*
 * The panel stores eight vertical pixels per byte, bit 0 at the top, so a
 * column of height h is (1 << h) - 1 with the top row always the whole byte.
 */
void renderTrend() {
  for (int x = 0; x < TREND_LEN; x++) {
    int height = trend[x];
    for (int p = 0; p < TREND_PAGES; p++) {
      int top = (TREND_PAGES - 1 - p) * 8;
      int lit = constrain(height - top, 0, 8);
      frame[(PAGES - TREND_PAGES + p) * W + x] = lit == 8 ? 255 : ((1 << lit) - 1);
    }
  }
}

void setup() {
  Serial.begin(115200);

  // A4 = SDA, A5 = SCL: the only two pins the TWI peripheral reaches. Two
  // arguments would move it, but on the Uno there is nowhere to move it to.
  Wire.begin();

  dht.begin(SENSOR_PIN);
  dht.begin(SENSOR_PIN);

  // The scan: one address at a time, asking each whether anybody is there.
  // Every one of these lands in the Bus Monitor, and only the line carrying
  // the acknowledged flag is a device.
  for (int a = 0x08; a <= 0x77; a++) {
    Wire.beginTransmission(a);
    Wire.endTransmission();
  }

  oledInit();
  Serial.println("3.1 ready");
}

void loop() {
  unsigned long now = millis();

  // Nothing in loop() waits. The frame happens once a second and the loop
  // keeps running the rest of the time, which is the whole discipline of this
  // exercise: on the bench, a delay() here is a logger that stops logging.
  if (now - lastFrame >= FRAME_MS) {
    lastFrame = now;

    float temperature = dht.temperature(SENSOR_PIN);
    float humidity = dht.humidity(SENSOR_PIN);

    // The interpreter has no cast syntax, so the truncation into a whole
    // percentage is the assignment, and the clamp is two lines rather than a
    // call because a knob can sit at the end of its travel.
    int percent = humidity;
    if (percent < 0) { percent = 0; }
    if (percent > 100) { percent = 100; }

    // The window shifts one column per sample: no ring buffer, no index
    // maths, and the oldest reading is simply overwritten.
    for (int i = 0; i < TREND_LEN - 1; i++) { trend[i] = trend[i + 1]; }
    trend[TREND_LEN - 1] = map(percent, 0, 100, 0, TREND_PAGES * 8);

    for (int i = 0; i < 1024; i++) { frame[i] = 0; }
    renderTrend();
    for (int p = 0; p < PAGES; p++) { flushPage(p); }

    frames++;
    Serial.print("t ");
    Serial.print(temperature);
    Serial.print(" C   rh ");
    Serial.print(percent);
    Serial.print(" %   frames ");
    Serial.println(frames);
  }
}
`,
  fault: {
    break_:
      'Declare a second frame buffer beside the first one — `byte scratch[1024];` — and leave ' +
      'everything else alone.',
    teaches:
      'On the bench the ATmega328P is holding 2048 bytes of array in 2048 bytes of SRAM. There is ' +
      'nothing left for the stack, so setup() resets before it reaches the first print and the board ' +
      'loops forever with an empty Serial monitor. It is the least dramatic and most common way to ' +
      'lose a display sketch: the firmware compiled, uploaded and reports nothing at all. The twin ' +
      'cannot show this — its buffers are host arrays, so declare the second one here and watch the ' +
      'panel carry on perfectly — which is exactly why the number 1024 vs 2048 is worth doing in ' +
      'your head before you go looking for the fault.',
  },
  hints: [
    {
      when: 'The Bus Monitor fills with a hundred lines and not one of them is marked acknowledged.',
      answer:
        'Nothing on the bus is answering, and there are three usual causes. SDA must be on A4 and SCL ' +
        'on A5 — they are not interchangeable, and a swapped pair leaves both lines pulled up with ' +
        'nobody listening. The pull-ups must be present, and present once. And the panel must have ' +
        'power on VCC; a display with no supply still sits there answering nothing.',
    },
    {
      when: 'The scan answers at 0x3C but the panel stays dark.',
      answer:
        'Acknowledging and lighting are two different things. The SSD1306 sits at 0x3C with its SA0 strap ' +
        'low and at 0x3D with it high, so check which one your module reports before concluding ' +
        'anything else. Then check the charge pump: without the 0x8D/0x14 pair the panel has no ' +
        'internal supply and stays black however many bytes you send it. A second panel answering at ' +
        '0x3C when you meant 0x3D is the same fault wearing a different mask.',
    },
    {
      when: 'The panel is lit but nothing appears on it, however much data I send.',
      answer:
        'Nearly always the control byte. The first byte after the address is always a stream selector: ' +
        '0x00 says "commands follow" and 0x40 says "pixel data follows". Write data without the 0x40 in ' +
        'front and the panel files your pixels as a command and its arguments, which is a blank screen ' +
        'rather than an error. Then check that the address commands ran: with the column pointer ' +
        'somewhere unexpected, a page write lands off the edge of the visible area.',
    },
    {
      when: 'Only the first 128 pixels update and the rest of the screen keeps what was there.',
      answer:
        'That is page addressing doing what it says: the column walks 0 to 127 and then returns to the ' +
        'start of the same page rather than dropping to the next one. A full redraw is eight page ' +
        'writes, each with its own 0xB0|page address — sixteen transactions in all. If you meant ' +
        'horizontal addressing, say so with 0x20/0x00.',
    },
    {
      when: 'The temperature and humidity stay at 0.00 however far I turn the sensor knobs.',
      answer:
        'The DHT22 is not on the I²C bus and never was — it has a single data wire, and the twin reads ' +
        'it through dht.temperature(SENSOR_PIN) and dht.humidity(SENSOR_PIN) rather than over a byte ' +
        'stream, so there is nothing for the Bus Monitor to show. Two checks: the number in those calls ' +
        'is the pin the sensor’s data wire is actually on, and a reading of exactly 0.00 means no part ' +
        'was found there at all, not a cold sensor.',
    },
    {
      when: 'The Serial monitor goes blank every time I upload.',
      answer:
        'That is expected, and it is the bus rather than the monitor. A4 and A5 are the Uno’s USB-serial ' +
        'lines, so the USB interface takes them over the moment the port opens and the monitor is reset ' +
        'along with the chip. Anything printed before the reset is lost. Waiting for the “3.1 ready” ' +
        'line before believing the first reading is the whole workaround.',
    },
  ],
  references: [
    {
      term: 'The address is seven bits, and the datasheet lies by one',
      what:
        'A device on I²C answers to a number the bus puts on the line before the data. That number is ' +
        'seven bits wide: 0x00 to 0x7F, and 0x08 to 0x77 are the ones reserved for devices, which is ' +
        'why the scan in setup() covers exactly that range. The confusion comes from the read bit: the ' +
        'wire carries eight bits, the low one saying read or write, so a datasheet that prints the ' +
        '8-bit form calls the SSD1306 0x78 where the library and the Bus Monitor say 0x3C. They are ' +
        'the same device: 0x3C << 1 = 0x78.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/wire/',
    },
    {
      term: 'Open-drain, open-collector, and why the pull-up is not optional',
      what:
        'No device on an I²C bus ever drives a line HIGH. A device says zero by sinking current to ' +
        'ground, and a HIGH exists only because current is flowing from VCC through the pull-up into ' +
        'the line’s own capacitance. That open-drain behaviour is not a weakness — it is what lets ' +
        'several devices share a wire without any of them having to agree who owns it, because a device ' +
        'that wants to transmit zero simply pulls the line down and everyone else stays quiet. It also ' +
        'puts the rise time in your hands: the pull-up is what charges the bus, so too large a resistor ' +
        'gives a slow, rounded edge and a timing error long before it gives a dead wire.',
    },
    {
      term: 'Why one device answers and the other does not',
      what:
        'Two panels configured identically answer at the same address, and the bus cannot tell them ' +
        'apart — every byte goes to both. The SSD1306 breaks the tie with SA0: low gives 0x3C, high ' +
        'gives 0x3D, and that strap is a solder jumper on the back of the module. So the first question ' +
        'when one device is silent and one is not is not "is it wired" but "what address is each of ' +
        'them actually claiming", and the answer comes from the scan rather than from the datasheet.',
    },
    {
      term: 'The control byte: 0x00 and 0x40',
      what:
        'On an I²C display the byte immediately after the address is never data — it is a stream ' +
        'selector, and its bit 6 says what the rest of the transaction holds. 0x00 means commands ' +
        'follow, 0x40 means pixel data follows. Skipping it is the commonest mistake in this whole ' +
        'exercise, because your pixels are consumed as a command and its arguments and the screen ' +
        'simply stays black. Note the consequence for arguments: a command and its arguments have to ' +
        'share one transaction, because a second transaction would put another control byte in front.',
    },
    {
      term: 'The SRAM budget: 1024 bytes out of 2048',
      what:
        'The panel’s own memory is 128 × 64 ÷ 8 = 1024 bytes, and the ATmega328P has 2048 bytes of ' +
        'SRAM in total. A frame buffer of your own is therefore half the chip before a single local ' +
        'variable, a stack frame or Serial’s 64-byte buffer has been counted. Two of them do not fit, ' +
        'and the failure is a board that resets inside setup() and reports nothing at all. This is why ' +
        'a graphics library for this class of part builds the image in one buffer, sends it, and never ' +
        'keeps a second copy.',
    },
    {
      term: '5 V and 3.3 V on the same bus',
      what:
        'A 3.3 V sensor wired to a 5 V pull-up sees 5 V on its own data pin, and many of them do not ' +
        'survive it. The Uno’s own SDA and SCL pins tolerate 5 V on input, which protects the ' +
        'microcontroller and does nothing at all for the sensor at the other end. When a bus mixes ' +
        'logic levels it needs a real bidirectional level shifter, or a device built to take 5 V; a ' +
        'resistor divider is not a substitute, because it cannot pull a line up when the other side is ' +
        'driving it low.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/wire/',
    },
  ],
  writeUp: 'docs/exercises/module-3-bus-protocols.md',
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    const sda = simulation.boardTerminal('A4');
    const scl = simulation.boardTerminal('A5');
    const data = simulation.boardTerminal('D2');
    if (!supply || !ground || !sda || !scl || !data) return;

    // The panel first: two wires to the bus, two to the rails. The bus reaches
    // the display only through the nets A4 and A5 sit on, which is why a
    // display wired anywhere else stays dark rather than working by accident.
    const oled = simulation.addPart(part('128x64 OLED (SSD1306)'), PART_X, PART_Y);
    const oledSda = simulation.pinAt(oled, 'SDA');
    const oledScl = simulation.pinAt(oled, 'SCL');
    const oledVcc = simulation.pinAt(oled, 'VCC');
    const oledGnd = simulation.pinAt(oled, 'GND');
    if (!oledSda || !oledScl || !oledVcc || !oledGnd) return;

    simulation.routeWire(sda, oledSda);
    simulation.routeWire(scl, oledScl);
    simulation.routeWire(supply, oledVcc);
    simulation.routeWire(ground, oledGnd);

    // One pull-up per line, from the 5 V rail down to the bus. The catalogue
    // has no 4.7 kΩ, so these are 10 kΩ: right shape, and the bench's bus is
    // modelled at transaction level, so the Multimeter is the part of this
    // exercise you cannot verify here.
    ['a', 'b'].forEach((_, index) => {
      const y = PART_Y + index * PART_STEP;
      const pull = simulation.addPart(part('10k Resistor'), PART_X + 62, y);
      const top = simulation.pinAt(pull, 'a');
      const bottom = simulation.pinAt(pull, 'b');
      if (!top || !bottom) return;
      simulation.routeWire(supply, top);
      simulation.routeWire(index === 0 ? sda : scl, bottom);
    });

    // The sensor is on a data wire of its own, not on the bus: three wires,
    // and nothing here joins the two protocols together.
    const sensor = simulation.addPart(part('DHT22 Temp/Humidity'), PART_X, PART_Y + PART_STEP);
    const sensorData = simulation.pinAt(sensor, 'SDA');
    const sensorVcc = simulation.pinAt(sensor, 'VCC');
    const sensorGnd = simulation.pinAt(sensor, 'GND');
    if (!sensorData || !sensorVcc || !sensorGnd) return;

    simulation.routeWire(data, sensorData);
    simulation.routeWire(supply, sensorVcc);
    simulation.routeWire(ground, sensorGnd);
  },
};


/* ------------------------------------------------------------------ *
 * 3.2 -- SPI High-Speed Display Control
 * ------------------------------------------------------------------ */

const SPI_DISPLAYS: Exercise = {
  id: '3.2',
  title: 'SPI High-Speed Display Control',
  level: 4,
  module: 'Module 3 — Serial Protocols & Hardware Bus Communication',
  difficulty: 'Intermediate',
  minutes: '75–90 mins',
  brief:
    'A shop-front instrument cluster: two panels on one microcontroller, and the clock and data lines ' +
    'they have in common. SPI has no addresses at all, so a device hears every byte unless a chip-select ' +
    'says otherwise — which puts the whole discipline in your hands and makes the framing the ' +
    'dangerous part. You are also spending 1024 bytes of the Uno’s 2048 bytes of SRAM on the frame ' +
    'buffer that feeds them, so what you do not draw is memory you still have.',
  concepts: [
    'A shared clock with no addresses on it',
    'Chip select is what makes a shared clock safe',
    'The transfer boundary frames a command sequence',
    'A frame buffer is half this chip’s RAM',
  ],
  parts: [
    { name: '128x64 OLED (SSD1306 SPI)', qty: 1, why: 'The panel that works, and the one you can watch.' },
    { name: '2.4" TFT (ILI9341)', qty: 1, why: '320×240 pixels behind the same four wires — and a second select.' },
  ],
  wiring: [
    { pin: 'D13', part: '128x64 OLED (SSD1306 SPI)', terminal: 'SCK', goesTo: 'the shared clock — every SPI device hears it' },
    { pin: 'D11', part: '128x64 OLED (SSD1306 SPI)', terminal: 'MOSI', goesTo: 'the shared data line' },
    { pin: 'D9', part: '128x64 OLED (SSD1306 SPI)', terminal: 'DC', goesTo: 'command or data — one pin, both meanings' },
    { pin: 'D10', part: '128x64 OLED (SSD1306 SPI)', terminal: 'CS', goesTo: 'this panel’s select, idling HIGH' },
    { pin: '5V', part: '128x64 OLED (SSD1306 SPI)', terminal: 'VCC', goesTo: 'the 5 V rail' },
    { pin: 'GND', part: '128x64 OLED (SSD1306 SPI)', terminal: 'GND', goesTo: 'the ground rail' },
    { pin: 'D13', part: '2.4" TFT (ILI9341)', terminal: 'SCK', goesTo: 'the same clock, joined to the OLED’s' },
    { pin: 'D11', part: '2.4" TFT (ILI9341)', terminal: 'MOSI', goesTo: 'the same data line' },
    { pin: 'D9', part: '2.4" TFT (ILI9341)', terminal: 'DC', goesTo: 'the same command/data pin' },
    { pin: 'D8', part: '2.4" TFT (ILI9341)', terminal: 'CS', goesTo: 'its own select — never the OLED’s pin' },
    { pin: '5V', part: '2.4" TFT (ILI9341)', terminal: 'VCC', goesTo: 'the 5 V rail' },
    { pin: 'GND', part: '2.4" TFT (ILI9341)', terminal: 'GND', goesTo: 'the ground rail' },
  ],
  steps: [
    'Wire the OLED module first: SCK to D13, MOSI to D11, D/C to D9, CS to D10, VCC to 5 V and GND to ground. On this bench D10 is the hardware select and D9 is the data/command line — on a real Uno the D/C wire is an ordinary GPIO the sketch drives with digitalWrite, which is a difference worth reading the references about rather than discovering on the bench.',
    'Wire the TFT onto the same three shared lines: SCK to D13, MOSI to D11, D/C to D9. Those three are shared on purpose, and it is safe precisely because of the fourth.',
    'Give the TFT its own CS on D8. This is the single most important wire in the exercise: two panels sharing a select is not two panels, it is one stream of bytes arriving at two controllers that each read it differently. Leave the TFT’s LED pin alone for now; the backlight is not part of the lesson.',
    'Put the sketch in the editor and press Run. The OLED lights and a bar scrolls through the middle of it; the TFT stays dark, because the bench recognises one SPI select and so cannot light a second panel on a select of its own. The wiring above is the correct circuit; that limitation is stated rather than hidden.',
    'Open the Bus Monitor. Every SPI transfer is logged there with its byte count and duration and no address, because SPI has no addresses — the address column reads null, and that empty cell is the lesson rather than a missing feature.',
    'Take the TFT’s CS off D8 and put it on D10 instead. It now wakes up and lights, which is the alarm: that panel has been handed every byte meant for the other one. The Bus Monitor does not change by a single line, because SPI has no acknowledge bit and no address to report a mistake through. That is what a select left asserted looks like, and why nothing warns you before the hardware does.',
    'Move it back to D8 before you go any further. Then add your own frame — fill pages 0 to 3, draw a shape into the buffer by hand, and watch the Bus Monitor stay at eight 131-byte transfers per full redraw however complicated the picture got: 1024 bytes of pixels and eight bytes of addressing, and nothing else.',
  ],
  sketch: `#include <Arduino.h>
#include <SPI.h>

/*
 * Module 3 twin for 3.2 -- one clock, two panels, and a frame buffer that is
 * half of this chip's RAM.
 *
 * Two things said plainly rather than faked:
 *   - SPI.beginTransaction() is the frame boundary here: it opens the window
 *     and SPI.end() closes it. Real Arduino wants an SPISettings argument
 *     there -- SPI.beginTransaction(kSettings) -- and this interpreter has
 *     nowhere to put one, so the sketch opens the window the way the bench
 *     needs it and the bench change is a single word.
 *   - The TFT's own CS on D8 is wired and driven honestly and lights nothing,
 *     because the bench recognises one SPI select. Wire it to D10 instead and
 *     it lights -- with the OLED's bytes, which is the fault this exercise is
 *     about rather than a limitation to work around.
 */

/*
 * The two selects are declared and driven as pins because on the bench they
 * are pins, whatever the bus model does with them.
 */

#define OLED_CS 10      // the hardware SS pin, which SPI.begin() leaves low
#define TFT_CS 8        // a second panel needs a second select
#define DC 9            // command or data: one pin, two meanings
#define W 128
#define PAGES 8
#define BAR_WIDTH 24
#define FRAME_MS 50

byte frame[1024];      // 1024 bytes -- half the Uno's 2048, for the image alone
byte pageBuffer[128];  // 128 bytes in flight, the only copy that ever exists
unsigned long lastFrame = 0;
int barX = 0;
int frames = 0;

/*
 * Every byte of a command sequence sits inside one open/close pair, and
 * SPI.end() is what tells the panel the sequence has ended. Break the sequence
 * in half and the trailing bytes become the start of the next command.
 *
 * The second argument to transfer() is the D/C state travelling with the byte.
 * Here it is 0 for a command *and for that command's arguments*, because
 * that is what a real D/C pin does -- it rises for pixel data and stays low
 * for the whole command sequence. The TFT module below is the exception its
 * own model makes, and it is called out where it happens.
 */
void oledInit() {
  SPI.beginTransaction();                          // the window opens
  SPI.transfer(0xAE, 0);                           // display off while it is set up
  SPI.transfer(0xD5, 0); SPI.transfer(0x80, 0);   // display clock divide
  SPI.transfer(0xA8, 0); SPI.transfer(0x3F, 0);   // multiplex ratio
  SPI.transfer(0x8D, 0); SPI.transfer(0x14, 0);   // charge pump on
  SPI.transfer(0x20, 0); SPI.transfer(0x02, 0);   // page addressing
  SPI.transfer(0xA1, 0);                           // segment remap
  SPI.transfer(0xC8, 0);                           // scan direction
  SPI.transfer(0xDA, 0); SPI.transfer(0x12, 0);   // COM pins
  SPI.transfer(0x81, 0); SPI.transfer(0xCF, 0);   // contrast
  SPI.transfer(0xAF, 0);                           // display on
  SPI.end();                                       // and the sequence is over
}

/*
 * Point the panel at a page, then push that page's 128 bytes. The buffer is
 * copied one page at a time rather than being an array the panel holds a
 * pointer to, because 1024 bytes sent is 1024 bytes sent at 8 MHz -- about a
 * millisecond of bus time nobody gets back.
 */
void pushPage(int which) {
  for (int x = 0; x < W; x++) { pageBuffer[x] = frame[which * W + x]; }

  SPI.beginTransaction();
  SPI.transfer(0xB0 | which, 0);      // page address
  SPI.transfer(0x00, 0);              // column low nibble
  SPI.transfer(0x10, 0);              // column high nibble -- column 0
  for (int x = 0; x < W; x++) { SPI.transfer(pageBuffer[x], 1); }
  SPI.end();
}

/*
 * The second panel, behind its own select. On the bench that pulse is the
 * only thing keeping the TFT off the OLED's command stream, and moving it onto
 * D10 is exactly the fault the exercise is built around.
 *
 * Note the argument bytes: the ILI9341's model takes a command's parameters
 * with the data flag set, where the OLED above took them as commands. That is
 * the module's own convention and it is the one its bench expects.
 */
void tftInit() {
  digitalWrite(TFT_CS, LOW);
  SPI.beginTransaction();
  SPI.transfer(0x11, 0);                       // sleep out
  SPI.end();
  delay(120);                                  // and the controller needs 120 ms
  SPI.beginTransaction();
  SPI.transfer(0x29, 0);                       // display on
  SPI.transfer(0x3A, 0); SPI.transfer(0x55, 1);// 16 bits per pixel
  SPI.end();
  digitalWrite(TFT_CS, HIGH);
}

void tftSelect() {
  digitalWrite(TFT_CS, LOW);
  SPI.beginTransaction();
  SPI.transfer(0x2B, 0);              // set the address window
  SPI.transfer(0x00, 1); SPI.transfer(0x00, 1);
  SPI.transfer(0x00, 1); SPI.transfer(0xEF, 1);
  SPI.transfer(0x2C, 0);              // ...then write pixels into it
  for (int i = 0; i < 64; i++) { SPI.transfer(0x00, 1); }
  SPI.end();
  digitalWrite(TFT_CS, HIGH);
}

/*
 * The whole frame is drawn in a host array and pushed a page at a time. Eight
 * vertical pixels live in each byte, so a full page of 0xFF is a solid
 * eight-row block and clearing the array is clearing the screen.
 */
void renderFrame() {
  for (int i = 0; i < W * PAGES; i++) { frame[i] = 0; }

  for (int x = barX; x < barX + BAR_WIDTH; x++) { frame[4 * W + x] = 255; }

  barX++;
  if (barX > W - BAR_WIDTH) { barX = 0; }
}

void setup() {
  Serial.begin(115200);

  SPI.begin();                        // the bus itself comes up; no window yet

  // A select idles HIGH, and on real hardware SPI.begin() has just left the
  // hardware SS pin low. Take the pin back as an ordinary output and drive it
  // yourself. The bench models no SS pin, so this is advice for the bench you
  // will eventually build rather than something visible here.
  pinMode(OLED_CS, OUTPUT);
  digitalWrite(OLED_CS, HIGH);
  pinMode(TFT_CS, OUTPUT);
  digitalWrite(TFT_CS, HIGH);
  pinMode(DC, OUTPUT);
  digitalWrite(DC, LOW);

  oledInit();

  // The TFT's own wake-up, once. It is the only way the second panel's command
  // stream reaches the bench at all, and with the selects where they belong
  // every byte of it is discarded -- which is the correct outcome rather than a
  // missing one.
  tftInit();
  Serial.println("3.2 ready");
}

void loop() {
  unsigned long now = millis();

  // Redrawing on a timer rather than on a wait: the bus time is paid by the
  // sketch, and delay() would simply add more of it on top.
  if (now - lastFrame >= FRAME_MS) {
    lastFrame = now;

    renderFrame();
    for (int p = 0; p < PAGES; p++) { pushPage(p); }
    tftSelect();

    frames++;
    Serial.print("frames ");
    Serial.println(frames);
  }
}
`,
  fault: {
    break_:
      'Move the TFT’s CS wire from D8 onto D10, so both panels hang off the same select, and run ' +
      'the sketch again.',
    teaches:
      'The TFT now wakes and lights, and it is drawing out of the OLED’s byte stream. It comes up black ' +
      'rather than full of the other panel’s picture only because its own write window happens to be ' +
      'pointing at a part of the glass the OLED’s page writes never reach — that is luck, not a ' +
      'mechanism, and moving the bar a line or two changes it. Nothing in the Bus Monitor changes: ' +
      'no address, no acknowledge bit, no error to read. Chip select is the entire mechanism that ' +
      'keeps two panels apart, so a shared select is not two displays, it is one byte stream handed ' +
      'to a second controller that reads it in its own dialect. On real hardware the same fault shows ' +
      'up the day a second chip joins the bus, and not before.',
  },
  hints: [
    {
      when: 'Neither panel lights and the Bus Monitor shows transfers with no acknowledged flag.',
      answer:
        'An SPI device reports nothing back, so the Bus Monitor’s acknowledged flag is the nearest ' +
        'thing to an answer and it is empty whenever no device is selected. Check the select first: ' +
        'CS goes to D10, and on real hardware D10 has to be taken back as an output and driven HIGH ' +
        'because SPI.begin() leaves the hardware SS pin low. Then SCK to D13, MOSI to D11 and D/C to ' +
        'D9 — a panel with no clock stays dark however many bytes you send it.',
    },
    {
      when: 'The OLED lights but shows noise, or fills with what looks like random pixels.',
      answer:
        'The command and data flags have swapped somewhere. In the Bus Monitor, bytes sent as ' +
        'commands and bytes sent as data are the same numbers; what separates them is the D/C state, ' +
        'which travels as the second argument to SPI.transfer — 0 for a command, 1 for a pixel. A ' +
        'missing 0 on the address commands, or a stray 1 on the page bytes, produces precisely this ' +
        'and nothing else.',
    },
    {
      when: 'The panel works alone and goes wrong the moment I add the second one.',
      answer:
        'That is a select problem, and it is the fault this exercise is about. Both panels are on the ' +
        'shared clock and the shared data line, which is fine; what must not be shared is CS. Move the ' +
        'TFT’s select off D10 onto a pin of its own and drive it with digitalWrite around its own ' +
        'transfers only. Sharing a select does not give you two devices, it gives one byte stream two ' +
        'readers.',
    },
    {
      when: 'Nothing happens at all until I add SPI.end(), or the display stops updating halfway through.',
      answer:
        'SPI.end() is the frame boundary the panel sees, and a command sequence has to sit inside one ' +
        'open/close pair — SPI.beginTransaction() to open it, SPI.end() to close it. Leaving a transfer ' +
        'open means the panel is still waiting for the rest of a command; ending one in the middle ' +
        'splits the sequence, and the bytes after the split are read as the start of the next command ' +
        'instead of as its arguments. That is also why a window opened and closed with nothing in it ' +
        'logs zero bytes and no time.',
    },
    {
      when: 'The Serial monitor reports frames, but the bar does not move.',
      answer:
        'Look at what you are pushing rather than at the timing. The frame buffer is 1024 bytes and it ' +
        'is never what the panel sees — a page has to be copied into it, the page address sent, and ' +
        'the 128 bytes pushed, once per page. Eight transfers of 131 bytes is the 1032 that a full ' +
        'redraw costs, and if the Bus Monitor shows eight transfers of three bytes you are sending ' +
        'the addressing and forgetting the data.',
    },
    {
      when: 'The sketch behaves differently on the bench than it does here.',
      answer:
        'Two honest differences. The bench recognises one SPI select, so the TFT wired to D8 stays dark ' +
        'while real Arduino, where CS is a pin you drive, would light it. And the bench models no clock ' +
        'polarity or phase, so a sketch that renders here and shows garbage on the bench is usually ' +
        'running in the wrong SPI mode — the SSD1306 wants mode 0. The bench proves the framing; the ' +
        'Logic Analyser proves the timing.',
    },
  ],
  references: [
    {
      term: 'I²C or SPI, and which one you are actually choosing',
      what:
        'I²C is two shared wires and an address on every transfer: few pins, many devices, slower, and ' +
        'every device has to agree on a speed the slowest can manage. SPI is separate wires per signal ' +
        'and no addressing at all: it is much faster, the board decides which chip is which by which ' +
        'wire you gave it, and it scales by adding pins rather than devices. Choose I²C when the pin ' +
        'count is the binding constraint and the devices are slow sensors or small displays; choose ' +
        'SPI when a screen has to move real pixels, and accept that each display costs its own select.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/spi/',
    },
    {
      term: 'Chip select, and why sharing a clock only works because of it',
      what:
        'SPI has no address byte, so every device on the clock and data lines hears every byte you ' +
        'send. Chip select is the one wire that says who is being spoken to: its device ignores ' +
        'everything while its own select is HIGH, and nothing else on the bus needs to know. That is ' +
        'why a shared clock is safe — the shared lines cost nothing, and each device is separated by a ' +
        'single pin that idles HIGH. A select left asserted is therefore not a slow device but a ' +
        'second device answering, which is why the fault appears the day a second chip joins the bus ' +
        'and never before.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/spi/',
    },
    {
      term: 'The transfer boundary frames a command sequence',
      what:
        'On a display, a command and the arguments that configure it have to arrive together — the ' +
        'bytes after a command are only its arguments while the device still considers it selected. ' +
        'So the low-to-high window on the select line is a semantic boundary, not just bookkeeping, ' +
        'and ending a transfer halfway through a command abandons it. On real Arduino that boundary ' +
        'is written SPI.beginTransaction(settings) and SPI.endTransaction(); on this bench the same ' +
        'window is opened by SPI.beginTransaction() with no argument — the interpreter has nowhere to ' +
        'hold SPISettings — and closed by SPI.end(). SPI.begin() is only the bus coming up, not a ' +
        'window.',
    },
    {
      term: 'The SRAM budget, and what a frame buffer costs',
      what:
        'A 128 × 64 monochrome frame is 128 × 64 ÷ 8 = 1024 bytes, and the ATmega328P has 2048 bytes ' +
        'of SRAM in total — the buffer is half the chip before a single local, before the stack, and ' +
        'before Serial’s 64-byte output ring. A 320 × 240 colour panel would want 153,600 bytes, which ' +
        'is why that class of display is streamed a page or a window at a time rather than buffered ' +
        'whole. The habit worth taking away: decide what the buffer has to hold, because everything it ' +
        'does not hold is memory you still have for the rest of the program.',
    },
    {
      term: 'Mode, bit order, and how fast the clock really goes',
      what:
        'SPI fixes four modes from two settings: the clock’s idle level (CPOL) and which edge samples the ' +
        'data (CPHA). The Arduino default is mode 0 — clock idles low, data sampled on the rising edge — ' +
        'and almost every display wants it, so a sketch that renders on one chip and shows garbage on ' +
        'another is usually in the wrong mode rather than miswired. Data goes MSB first, which is why ' +
        'the first byte clocked into a daisy chain of shift registers lands in the device furthest from ' +
        'the microcontroller and a cascade has to index its frame backwards.',
      readMore: 'https://docs.arduino.cc/language-reference/en/functions/comm/spi/',
    },
    {
      term: '5 V and 3.3 V on the same SPI bus',
      what:
        'SPI has no open-drain lines and no pull-ups, so every level is driven — and a 3.3 V display ' +
        'reading a 5 V clock can be damaged by it. The Uno is a 5 V part and most SPI modules are 5 V ' +
        'parts, so the two agree; the moment you move the microcontroller to a 3.3 V board, every input ' +
        'threshold is a question again, and a 74HC595 needing 3.5 V of input will not hear 3.3 V logic ' +
        'at all. MISO is the line people forget: it is driven by the device, so a 5 V peripheral on a ' +
        '3.3 V controller feeds 5 V back into a pin that cannot take it.',
    },
  ],
  writeUp: 'docs/exercises/module-3-bus-protocols.md',
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    const clock = simulation.boardTerminal('D13');
    const data = simulation.boardTerminal('D11');
    const command = simulation.boardTerminal('D9');
    if (!supply || !ground || !clock || !data || !command) return;

    /*
     * Three lines are shared by both panels and one is not, which is the whole
     * shape of the exercise. The clock, the data line and the D/C pin go to
     * both modules; each select goes to a pin of its own.
     */
    const shared = [
      { name: '128x64 OLED (SSD1306 SPI)', y: PART_Y, select: 'D10' },
      { name: '2.4" TFT (ILI9341)', y: PART_Y + PART_STEP, select: 'D8' },
    ];

    shared.forEach(({ name: partName, y, select }) => {
      const display = simulation.addPart(part(partName), PART_X, y);
      const board = simulation.boardTerminal(select);
      const chipSelect = simulation.pinAt(display, 'CS');
      const dataCommand = simulation.pinAt(display, 'DC');
      const mosi = simulation.pinAt(display, 'MOSI');
      const sck = simulation.pinAt(display, 'SCK');
      const vcc = simulation.pinAt(display, 'VCC');
      const gnd = simulation.pinAt(display, 'GND');
      if (!board || !chipSelect || !dataCommand || !mosi || !sck || !vcc || !gnd) return;

      simulation.routeWire(clock, sck);
      simulation.routeWire(data, mosi);
      simulation.routeWire(command, dataCommand);
      simulation.routeWire(board, chipSelect);
      simulation.routeWire(supply, vcc);
      simulation.routeWire(ground, gnd);
    });
  },
};


export const MODULE_3: readonly Exercise[] = [I2C_MONITOR, SPI_DISPLAYS];