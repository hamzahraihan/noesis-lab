# Module 3 — Serial Protocols & Hardware Bus Communication

Two wires and eight wires: the bus that is addressable, open-drain and clock-stretched, and the bus that is fast, frameless and yours alone.
On the Uno R3 the first runs out of A4/A5 and fights the USB port for them, the second out of D11/D12/D13 and the hardware SS pin, and both run out of SRAM before they run out of pins.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| 3.1 | $I^2C$ Environmental Monitor with OLED & Sensor | Intermediate | 75–90 mins |
| 3.2 | SPI High-Speed Display Control | Intermediate | 75–90 mins |

---

### 3.1: $I^2C$ Environmental Monitor with OLED & Sensor
**Difficulty Level:** Intermediate
**Level:** 4
**Estimated Completion Time:** 75–90 mins

#### 1. Real-World Scenario
A cold-chain logger clipped inside a vaccine transport case. It samples temperature and humidity twice a second, keeps a rolling 64-sample trend, and redraws a 128×64 OLED once a second, all while the case keeps logging — so nothing in `loop()` may block. One bus, two devices on it, and 2 KB of SRAM between the firmware and a frame buffer that wants 1024 bytes of it.

#### 2. Hardware Inventory & Pinout Map
| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| A4 (SDA) | OLED SDA, SHT31 SDA | the shared SDA net | TWI data, and the USB-serial data line |
| A5 (SCL) | OLED SCL, SHT31 SCL | the shared SCL net | TWI clock, and the USB-serial clock line |
| 5 V, GND | OLED VCC/GND, SHT31 VCC/GND | Uno rails | Modules take 3.3–5 V; the charge pump wants 5 V for contrast |
| 5 V | R1 top → SDA net, R2 top → SCL net | 2 × 4.7 kΩ to 5 V | Fit **only if the modules carry none** |
| 5 V → GND | C1 at the OLED, C2 at the SHT31 | each module's own pins | 2 × 100 nF |

Bill of materials: Uno R3; 128×64 SSD1306 I²C OLED (0x3C, or 0x3D with SA0 high); SHT31 breakout (0x44) or BME280 (0x76/0x77); 2 × 4.7 kΩ; 2 × 100 nF; breadboard and jumpers. Before fitting pull-ups, power the board with nothing on the bus and meter SDA-to-5 V: a few kΩ means the modules already have a pair, and a second one leaves $4700 \parallel 4700 = 2350\ \Omega$, twice the sink current for nothing.

#### 3. Circuit Schematics & Wiring Guide
```text
                        +5 V  (Uno 5V pin)
                          |
            +-------------+-------------+
            |                           |
        [R1 4.7 k]                 [R2 4.7 k]   fit ONLY if the modules bring none
            |                           |
  A4 (SDA) -+---------------------------+-------->  OLED SDA, SHT31 SDA
  A5 (SCL) --+---------------------------+-------->  OLED SCL, SHT31 SCL
  GND rail --------------------------------------->  OLED GND, SHT31 GND; 100 nF at each VCC
```
1. Break the breadboard's rails and solder them together: one ground, one 5 V.
2. Power the board empty, meter SDA-to-5 V, and let that reading decide whether step 3 is needed.
3. Fit R1 from 5 V to the SDA net and R2 from 5 V to the SCL net, if step 2 called for them.
4. OLED: GND, VCC, SCL and SDA as above; the SHT31 onto the same two nets — it hangs off the bus, not off the OLED. Upload the scanner from section 5 and confirm two addresses before running anything else.
**Hardware Gotchas & Safety Rules:**
- **SDA and SCL are not interchangeable.** A swapped pair leaves both lines pulled up, both devices silent, and the scanner printing phantom addresses.
- **A4/A5 are the USB-serial lines.** The Serial Monitor blanks for a second or two during every upload, and anything `setup()` printed before the reset is lost.
- **Never tie SDA or SCL to 5 V.** They are open-drain: a hard connection shorts the pull-up on every low bit. And check the address strap — SA0 low gives 0x3C, SA0 high gives 0x3D.

#### 4. Embedded Concept Deep-Dive
**Open-drain.** No device ever drives the line high; a HIGH exists only because current flows from $V_{CC}$ through the pull-up into the line's own capacitance. A device says zero by sinking, and the pull-up sets that current: $I_{sink} = (V_{CC} - V_{OL})/R_{pull\text{-}up} = (5 - 0.4)/4700 = 0.98$ mA, comfortably inside the few mA an SSD1306 or SHT31 will sink; a 220 Ω pull-up would demand 21 mA and the device would stop answering. The rise time is the pull-up charging the bus, $t_r \approx 0.8473 R_{pull} C_{bus}$.
**Mode against capacitance, and addressing.** Standard mode (100 kHz) demands $t_r \le 1000$ ns, so 4.7 kΩ holds it while $C_{bus} \le 1000\text{ ns}/(0.8473 \times 4700) = 251$ pF; fast mode (400 kHz) demands $t_r \le 300$ ns, which 4.7 kΩ holds only below 75 pF and 10 kΩ only below 35 pF, which is why 10 kΩ pull-ups work on a short bus and fail on a long one. The 400 pF ceiling is on the *wire*: jumper costs about 1 pF per centimetre, so a 40 cm bus spends a tenth of the budget before either device speaks. The bus carries a 7-bit address and the wire carries eight, which is why the SSD1306 datasheet prints `0x78` where the library wants `0x3C`: $0x3C \ll 1 = 0x78$. Fixed addresses: SSD1306 0x3C/0x3D by SA0, BME280 0x76 or 0x77 by SDO, SHT31 0x44 with no alternative. Two devices at one address cannot share a bus — a write reaches both and a read is answered by whichever pulls hardest — so the fix is a TCA9548A multiplexer at 0x70–0x77 with eight channels.
**Stretching, the RAM bill, and what a flush costs.** A slave may hold SCL low, and the ATmega328P's TWI stretches only in slave mode; as a master it raises a STOP condition instead of waiting, and `endTransmission()` returns 0 on acknowledge, 2 when the address is not acknowledged, anything else naming the bus error. The panel's memory is $128 \times 64 / 8 = 1024$ bytes and the ATmega328P has 2048 bytes of SRAM in total, so the buffer is half of it before a single local exists; the rest carries the stack, `Serial`'s 64-byte buffer and every intermediate. A second frame buffer is not a rounding error — 2048 bytes of array plus a stack is a reset loop — and the font has the same problem from the other side, because a plain `const` array is copied from flash into SRAM at startup. One page of a flush is one addressing transaction plus one 129-byte data transaction, so eight pages is 16 transactions and 1088 bytes: $1088 \times 9 / 100\,000 \approx 98$ ms at 100 kHz, about 24 ms at 400 kHz, which is why the frame is assembled in RAM and pushed once.

#### 5. Firmware Challenge & Code Template
**Starter Code Scaffold**
```cpp
#include <Wire.h>
#include <avr/pgmspace.h>
#define OLED_ADDR 0x3C
#define SENSOR_ADDR 0x44
#define W 128
#define PAGES 8
#define TREND_LEN 64
#define TREND_TOP 40
#define TREND_H 23
#define FRAME_MS 1000UL
#define SAMPLE_MS 500UL
#define CONV_MS 20UL          // the SHT31 needs 15 ms of conversion time
#define LOG_MS 500UL
uint8_t fb[W * PAGES];       // 1024 bytes: half of the 328P's 2048, up front
uint8_t trend[TREND_LEN];
char row[24];
float temperatureC = 0.0, humidityPct = 0.0;
int oledSeen = -1, sensorSeen = -1, converting = 0;
unsigned long samples = 0, lastTrigger = 0, lastFrame = 0, lastLog = 0;

// 5x7 glyphs, column major, bit 0 the top row. PROGMEM keeps them in flash; a plain
// const array would be copied into SRAM at startup, and there is no room for that.
const char FONT_KEYS[] PROGMEM = " .-0123456789%CEHKNORST";
const uint8_t FONT_5X7[][5] PROGMEM = {
  {0x00, 0x00, 0x00, 0x00, 0x00}, {0x00, 0x60, 0x60, 0x00, 0x00}, {0x08, 0x08, 0x08, 0x08, 0x08}, {0x3E, 0x51, 0x49, 0x45, 0x3E},
  {0x00, 0x42, 0x7F, 0x40, 0x00}, {0x42, 0x61, 0x51, 0x49, 0x46}, {0x21, 0x41, 0x45, 0x4B, 0x31}, {0x18, 0x14, 0x12, 0x7F, 0x10},
  {0x27, 0x45, 0x45, 0x45, 0x39}, {0x3C, 0x4A, 0x49, 0x49, 0x30}, {0x01, 0x71, 0x09, 0x05, 0x03}, {0x36, 0x49, 0x49, 0x49, 0x36},
  {0x06, 0x49, 0x49, 0x29, 0x1E}, {0x23, 0x13, 0x08, 0x64, 0x62}, {0x3C, 0x4A, 0x49, 0x49, 0x30}, {0x7F, 0x48, 0x44, 0x44, 0x38},
  {0x7F, 0x08, 0x08, 0x08, 0x7F}, {0x7F, 0x08, 0x14, 0x22, 0x41}, {0x7F, 0x09, 0x19, 0x29, 0x46}, {0x3E, 0x41, 0x41, 0x41, 0x3E},
  {0x7C, 0x12, 0x11, 0x12, 0x0C}, {0x46, 0x49, 0x49, 0x49, 0x31}, {0x01, 0x01, 0x7F, 0x01, 0x01}
};
#define GLYPHS ((int)(sizeof(FONT_5X7) / 5))
int freeRAM() { extern int __heapstart, *__brkval; int v; return (int)&v - (__brkval == 0 ? (int)&__heapstart : (int)__brkval); }
void oledCommand(int c) { Wire.beginTransmission(OLED_ADDR); Wire.write(0x00); Wire.write(c); Wire.endTransmission(); }
bool probe(int address) { Wire.beginTransmission(address); return Wire.endTransmission() == 0; }
void i2cScan() {
  Serial.println(F("-- scan 0x08..0x77 --"));
  for (int a = 0x08; a <= 0x77; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { Serial.print(F("  0x")); if (a < 0x10) Serial.print('0'); Serial.println(a, HEX); }
  }
  Serial.println(F("-- end of scan --"));
}
void oledInit() {                                     // each pair is a command and its argument
  oledCommand(0xAE); oledCommand(0xD5); oledCommand(0x80); oledCommand(0xA8); oledCommand(0x3F);
  oledCommand(0xD3); oledCommand(0x00); oledCommand(0x8D); oledCommand(0x14); oledCommand(0x20);
  oledCommand(0x02); oledCommand(0xA1); oledCommand(0xC8); oledCommand(0xDA); oledCommand(0x12);
  oledCommand(0x81); oledCommand(0xCF); oledCommand(0x21); oledCommand(0x00); oledCommand(W - 1);
  oledCommand(0x22); oledCommand(0x00); oledCommand(PAGES - 1); oledCommand(0xAF);
}
void drawString(int column, int page, const char *text) {
  for (int x = column; *text != '\0' && x < W; x += 6) {
    int i = 0;
    while (i < GLYPHS && (char)pgm_read_byte(&FONT_KEYS[i]) != *text) i++;
    if (i >= GLYPHS) i = 1;                           // an unknown glyph draws as '.'
    for (int c = 0; c < 5 && x + c < W; c++) fb[page * W + x + c] = pgm_read_byte(&FONT_5X7[i][c]);
    text++;
  }
}
// One decimal place by hand: float printf costs about 1.7 kB of flash and a cold-chain
// log does not need it. No String, no malloc, no sprintf.
void formatRow(char *out, const char *label, float value, const char *unit) {
  int n = 0, s = (int)(value * 10.0 + (value >= 0.0 ? 0.5 : -0.5)), w;
  while (*label != '\0') out[n++] = *label++;
  if (s < 0) { out[n++] = '-'; s = -s; }
  w = s / 10;                                         // whole part, then '.', then the tenth
  if (w >= 100) out[n++] = (char)('0' + w / 100);
  if (w >= 10) out[n++] = (char)('0' + (w / 10) % 10);
  out[n++] = (char)('0' + w % 10); out[n++] = '.';
  out[n++] = (char)('0' + s % 10);
  while (*unit != '\0') out[n++] = *unit++;
  out[n] = '\0';
}
bool sensorStart() { Wire.beginTransmission(SENSOR_ADDR); Wire.write(0x2C); return Wire.endTransmission() == 0; }
bool sensorFinish(float *outT, float *outH) {
  if (Wire.requestFrom(SENSOR_ADDR, 6) != 6) return false;
  unsigned int rawT = ((unsigned int)Wire.read() << 8) | (unsigned int)Wire.read();
  unsigned int rawH = ((unsigned int)Wire.read() << 8) | (unsigned int)Wire.read();
  *outT = (float)rawT * (175.0 / 65536.0) - 46.85;     // -45..130 C over 16 bits
  *outH = (float)rawH / 65535.0 * 100.0;               // 0..100 %RH over 16 bits
  return true;
}
void renderFrame(int sensorOk) {
  for (int i = 0; i < W * PAGES; i++) fb[i] = 0;
  formatRow(row, "T  ", temperatureC, " C");           drawString(0, 0, row);
  formatRow(row, "RH ", humidityPct, " %");            drawString(0, 1, row);
  formatRow(row, "N  ", (float)(samples % 1000), ""); drawString(0, 2, row);
  drawString(0, 3, sensorOk ? "OK" : "NO SENSOR");
  for (int x = 0; x < TREND_LEN; x++) {                // trend columns, oldest at the left
    int y = TREND_TOP + TREND_H - 1;
    for (int p = 0; p < trend[x]; p++) fb[((y - p) >> 3) * W + x] |= (uint8_t)(1 << ((y - p) & 7));
  }
  for (int page = 0; page < PAGES; page++) {           // one flush per frame, never per pixel
    Wire.beginTransmission(OLED_ADDR); Wire.write(0x00);
    Wire.write(0x21); Wire.write(0x00); Wire.write(W - 1);
    Wire.write(0x22); Wire.write(page); Wire.write(page); Wire.endTransmission();
    Wire.beginTransmission(OLED_ADDR); Wire.write(0x40);   // control byte: data follows
    for (int x = 0; x < W; x++) Wire.write(fb[page * W + x]);
    Wire.endTransmission();
  }
}
void setup() {
  Serial.begin(115200);
  Wire.begin();                 // A4 = SDA, A5 = SCL: the only pins the TWI peripheral reaches
  Wire.setClock(100000);        // 100 kHz standard mode, which is 98 ms per full flush
  delay(10);                    // the SHT31 needs 1.5 ms after power-up; once is free
  i2cScan();
  oledSeen = probe(OLED_ADDR) ? 1 : 0;
  sensorSeen = probe(SENSOR_ADDR) ? 1 : 0;
  if (oledSeen) oledInit();
  Serial.print(F("ram free with the buffer: ")); Serial.println(freeRAM());
  Serial.print(F("oled ")); Serial.println(oledSeen);
  Serial.print(F("sensor ")); Serial.println(sensorSeen);
}
void loop() {
  unsigned long now = millis();
  if (now - lastTrigger >= SAMPLE_MS) {                 // trigger, then leave the chip alone
    lastTrigger = now;
    converting = sensorSeen ? (sensorStart() ? 1 : 0) : 0;
  }
  if (converting && (now - lastTrigger >= CONV_MS)) {
    float t, h;
    if (sensorFinish(&t, &h)) {
      temperatureC = t; humidityPct = h; samples++;
      for (int i = 0; i < TREND_LEN - 1; i++) trend[i] = trend[i + 1];
      trend[TREND_LEN - 1] = (uint8_t)constrain(map((long)(t * 10.0), -100L, 600L, 0, TREND_H), 0, TREND_H);
    }
    converting = 0;
  }
  if (now - lastFrame >= FRAME_MS) {
    lastFrame = now;
    if (oledSeen) renderFrame(sensorSeen);              // TODO: an alarm row outside 2..8 C
  }
  if (now - lastLog >= LOG_MS) {
    lastLog = now;
    formatRow(row, "t=", temperatureC, "  rh="); Serial.print(row);
    formatRow(row, "", humidityPct, ""); Serial.print(row);
    Serial.print(F("  n=")); Serial.println(samples);
  }
}
```
**Functional Requirements**
- Run `i2cScan()` first and paste its output into your report; the addresses must match `OLED_ADDR` and `SENSOR_ADDR`.
- Trigger, leave, collect: the 15 ms conversion is a state machine on `millis()`, never a wait. Format both readings into `char` buffers; render three text rows plus a 64-column trend that shifts left one column per sample; assemble the frame in `fb` and flush once, never per pixel.
- Print a diagnostic at 2 Hz, and detect a missing display at startup and report it once — never hang on a device that is not there.
**Constraints**
- No `delay()` in `loop()`; the single delay in `setup()` is justified inline. No `while` loop whose condition involves `Wire`.
- No `malloc`, no `String`, no `sprintf`, and exactly one 1024-byte buffer for the life of the sketch. `Wire.setClock(100000)` is allowed; do not exceed 400 kHz on a breadboard bus.

#### 6. Verification Checklist & Debugging Tasks
1. Bus empty, meter SDA-to-5 V. Record the reading; it decides whether wiring step 3 applies.
2. Paste the scanner output: exactly two addresses, matching the two constants in the sketch.
3. `ram free with the buffer:` sits near 900 bytes, not near 1900.
4. Warm a fingertip on the SHT31: `t=` climbs within 30 s and the newest trend column rises while older columns do not move.
5. Watch the Serial Monitor through an upload — it blanks while the 328P is held in reset and USB takes A4/A5 over. Count `Wire.endTransmission()` calls per frame on the Logic Analyser while you are there: 16, once a second, not 1024.
**Simulated Hardware Fault:**
**Symptom:** the scanner prints `0x00` and `0x77`, or prints nothing at all, and the display never lights. A correctly wired bus can only produce two real addresses.

**Diagnosis:** (1) Swap SDA and SCL and re-run — a swapped pair leaves both lines pulled up, nothing acknowledges the intended address, and phantom addresses appear at the ends of the scan range, exactly `0x00` and `0x77`. (2) Board powered, bus empty: meter SDA-to-5 V. Infinity means no pull-up anywhere; a few kΩ means the modules brought their own. (3) Do not trust wire colours: with the board unpowered, meter continuity from the module's SDA pad to A4 and its SCL pad to A5. (4) If addressing is right and the panel is still dark, suspect RAM — add a second `uint8_t buffer[1024];` at file scope and upload. The 328P then holds 2048 bytes of array plus a stack in 2048 bytes of SRAM, resets inside `setup()`, and the `ram free` line never prints, which is exactly what that banner exists to show.

**Fix:** SDA to A4, SCL to A5, pull-ups present exactly once, one frame buffer.

#### 7. Noesis Lab Twin
Parts by catalogue name: `128x64 OLED (SSD1306)` (id `ssd1306-128x64`, header GND/VCC/SCL/SDA), `10k Resistor` ×2, `DS1307 Real-Time Clock` (id `ds1307-rtc`, header GND/VCC/SDA/SCL) as the bus's second device; board Uno R3. Wire both GND pins to ground, both VCC pins to 5 V, both SDA pins to A4 and both SCL pins to A5: the twin reaches the bus only through the nets A4/A5 sit on, and a display wired elsewhere stays dark.
- **Pull-ups and sensors, honestly.** The catalogue stocks 220 Ω, 330 Ω, 1 kΩ, 10 kΩ and 100 kΩ and has no 4.7 kΩ part, and the display part carries no modelled pull-up of its own, so the twin uses `10k Resistor`; the twin's I²C bus is modelled at transaction level and fixed at 400 kHz — 22.5 µs per byte regardless of the resistors — so fit them so the Multimeter reads 10 kΩ and the drawing matches the bench. The twin has no temperature/humidity part on I²C at all: its modelled I²C devices are the `DS1307 Real-Time Clock` at 0x68, the `MPU-6050 Accelerometer` at 0x68 — they share an address, so only one may sit on a bus at a time — and the `HX711 Load-Cell Amplifier` at 0x28, while the analogue equivalents are `Thermistor (NTC) Module` on an analogue pin and `DHT22 Temp/Humidity` on one wire. Use the RTC: it gives the same two-address bus shape as 0x3C + 0x44.
- **Twin edits and what works there.** Delete `#include <avr/pgmspace.h>`, drop both `PROGMEM` keywords, change `pgm_read_byte(&FONT_5X7[i][c])` to `FONT_5X7[i][c]` and `pgm_read_byte(&FONT_KEYS[i])` to `FONT_KEYS[i]`, and delete `freeRAM()` with its call — the interpreter has no `__heapstart`. `Wire.begin`, `beginTransmission`, `write`, `endTransmission`, `requestFrom`, `read` and `available` all work and every transfer logs time, bus, 7-bit address, bytes and duration in the Bus Monitor; `Wire.setClock(100000)` is accepted and ignored, and `endTransmission()` always returns 0 there, so read the **acknowledged** column rather than the scan's return value.
- **Verifiable here:** addressing and the scan, the SSD1306 control-byte convention (`0x00` commands, `0x40` data), the trend rendering, and the flush discipline — 16 transfers, about 23 ms of modelled bus time that the sketch really waits out. **Bench-only:** the RAM budget (the twin's frame buffer is a host array, so nothing runs out of memory), the pull-up rise time and the $C_{bus}$ ceiling, clock stretching, and the SHT31's 15 ms window.
**A complete sketch for the simulator** — no framebuffer, no font, no `pgmspace`, and no ACK test the twin cannot honour:
```cpp
void setup() {
  Wire.begin();
  for (int a = 0x08; a <= 0x77; a++) { Wire.beginTransmission(a); Wire.endTransmission(); }
  Wire.beginTransmission(0x3C); Wire.write(0x00); Wire.write(0xAE); Wire.endTransmission();
  Wire.beginTransmission(0x3C); Wire.write(0x00); Wire.write(0xAF); Wire.endTransmission();
}
void loop() { }
```
Every transfer lands in the Bus Monitor: only the addresses that answered carry the `acknowledged` flag, and the panel comes on because the `0x00` control byte told it the next byte was a command.

### 3.2: SPI High-Speed Display Control
**Difficulty Level:** Intermediate
**Level:** 4
**Estimated Completion Time:** 75–90 mins

#### 1. Real-World Scenario
A shop-front instrument cluster on one microcontroller: a 24-LED bargraph driven by three cascaded shift registers, with an SSD1306 on SPI reprinting a scrolling status line beside it. The bargraph has to look continuous while the display redraws, which means the 24 bits are assembled somewhere else and delivered as one indivisible frame.

#### 2. Hardware Inventory & Pinout Map
| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| D13 (SCK) | SRCLK of #1, #2, #3 | all three shift clocks | One edge shifts one bit into all three |
| D11 (MOSI) | SER of #1 | the first package only | Nearest the MCU, so it is fed first |
| — | QH' of #1 → SER of #2, QH' of #2 → SER of #3 | package to package | Not board pins; daisy chain, never a star |
| D10 (SS) | RCLK of #1, #2, #3 | all three latches | Exactly one pulse per frame |
| D8, D9 | OLED CS, OLED D/C | OLED module | D/C driven with `digitalWrite`, not by `SPI` |
| D12 (MISO) | — | unconnected | Nothing drives it; the sketch ignores the return |
| 5 V | 24 anodes, each cathode through 1 kΩ to Q1..Q8 | the 5 V rail | $I = (5 - 1.9)/1000 = 3.1$ mA each; current bypasses the MCU |

Bill of materials: Uno R3; 3 × 74HC595; 24 × LEDs; 24 × 1 kΩ; 3 × 100 nF across pins 16 (VCC) to pin 8 (GND) at each chip; 128×64 SSD1306 SPI module (8 wires); breadboard and jumpers.

#### 3. Circuit Schematics & Wiring Guide
```text
   UNO R3                      CASCADE (daisy chain, never a star)
  +--------+      +--------+      +--------+      +--------+
  | D13 o--+------+ SRCLK  |      | SRCLK  |      | SRCLK  |
  | D11 o--+------+ SER    +--QHT-| SER    +--QHT-| SER    |
  | D10 o--+------+ RCLK  +------+ RCLK  +------+ RCLK  |
  | D8/D9 +--+---> OLED CS|D/C   |Q1..Q8 |      |Q1..Q8 |      |Q1..Q8|
  +--------+               +--100nF-+     +--100nF-+     +--100nF-+
                           5 V rail -------------------------------> 24 anodes
```
1. Fit a 100 nF across pins 16 and 8 of each 595 first, physically at the pins, and common GND and 5 V to all three packages.
2. Tie each output enable to ground and each master reset to 5 V: both are active low, and floating means no outputs and random resets.
3. D13 to all three SRCLK pins; D10 to all three RCLK pins; D11 to #1's SER, #1's QH' to #2's SER, #2's QH' to #3's SER.
4. All 24 anodes to 5 V, each cathode through its own 1 kΩ to one output. OLED: CS to D8, D/C to D9, DIN to D11, CLK to D13.
Read pin numbers off the part in your hand: the function names above are the datasheet's, the numbers are not printed on a 16-pin package, and a drawing is not a datasheet.
**Hardware Gotchas & Safety Rules:**
- **Never share D10 between RCLK and the OLED's chip select.** The SSD1306 needs CS low across a whole command and its arguments, so a latch pulse mid-sequence deselects it and abandons the command.
- **Never call `SPI.transfer(value, 1)` when D10 is your latch.** On the AVR the two-argument overload drives the hardware SS pin as the data/command line, so that call strobes your latch instead of your display. Drive D/C with `digitalWrite`.
- **`SPI.begin()` leaves D10 low**, and a latch idling low is not an idle latch: call `SPI.begin()`, then `pinMode(10, OUTPUT)` and `digitalWrite(10, HIGH)`, and leave it an output. Decoupling belongs at pins 16 and 8, not on the rail.
- **Derive the LED resistor before fitting it.** 220 Ω gives 14.1 mA per LED and 112.8 mA per package, past the 595's 70 mA total per package.

#### 4. Embedded Concept Deep-Dive
**Three signals, and the order they act in.** Data shifts in on the **rising edge of SRCLK**; nothing reaches the outputs until **RCLK rises**, which copies the whole 24-bit shift register into the output latches at once. That is the entire point: 24 outputs cannot show a half-updated frame, because they all change on one edge.
**Clock mode, bit order, and clock rate.** The 595 samples data on the leading rising edge with the clock idling low: SPI mode 0, CPOL = 0 and CPHA = 0, the Arduino default. Mode 3 also works; modes 1 and 2 sample on the trailing edge and shift garbage. SPI is MSB first, and the first bit clocked into a cascade travels the whole chain before it settles, so it ends up in the *last* package — the first byte sent lands on the LEDs furthest from the MCU, which is why the code below indexes `CHAIN_BYTES - 1 - (i / 8)`. And $f_{SCK} = f_{osc}/D$, so on a 16 MHz ATmega328P `SPI_CLOCK_DIV2` is 8 MHz, `DIV4` is 4 MHz and `DIV8` is 2 MHz: the 74HC595's $f_{max}$ of 20 MHz at $V_{CC} = 4.5$ V is never the limit, the wire is. Twenty centimetres of unshielded Dupont has enough inductance to ring a fast edge into the region where only the HC's noise margin protects you, so stay at `DIV4` until the Logic Analyser says otherwise.
**Hardware against bit-banging.** `SPI.transfer()` moves a byte out of the hardware shift register in roughly 2–4 µs including call overhead at these clocks; `shiftOut()` with direct port access is about 8 µs per byte; `digitalWrite()` bit-banging costs roughly 3.5 µs a call and needs sixteen calls a byte — two clock writes and eight data writes — so about 50–60 µs per byte, seven times worse than port-level and thirty times worse than the peripheral. The peripheral is also double-buffered: the shift register keeps clocking out while the transmit buffer reloads, so a call returns with the previous byte still on the wire. (The 64-byte FIFO in this chip belongs to the USART, not the SPI — the SPI has two stages, not a queue.)
**The current budget, derived not given.** The 74HC595 sinks $I_{OL} = 25$ mA per output at $V_{OL} = 0.4$ V, and its total per package is $I_{tot} = 70$ mA; eight outputs per package share 70 mA, not 200. Per pin alone, $I \le 25$ mA gives $R \ge (5 - 1.9)/0.025 = 124\ \Omega$; the package total gives $I \le 70/8 = 8.75$ mA and $R \ge (5 - 1.9)/0.00875 = 354\ \Omega$, so the package limit binds. At 1 kΩ: 3.1 mA per LED, 24.8 mA per package, 74.4 mA across all three. At 220 Ω: 14.1 mA per LED and 112.8 mA per package, over by 61 %. The LED current comes off the 5 V rail rather than through a microcontroller pin, so the Uno's 200 mA I/O budget is not what limits this — the board's supply path is. When even 1 kΩ is too much, the answers are multiplex or a constant-current driver.
**Logic levels.** A 74HC595 on 5 V needs $V_{IH} = 0.7 V_{CC} = 3.5$ V, which 3.3 V logic does not reach; a 74HCT595 has a fixed 2.0 V threshold and is the drop-in fix, powering the HC from 3.3 V also works, and otherwise every line needs a real level shifter. Note too that D11, D12 and D13 are PB3, PB4 and PB5, shared with the JTAG port — the SPI peripheral takes them the moment it starts.

#### 5. Firmware Challenge & Code Template
**Starter Code Scaffold**
```cpp
#include <SPI.h>
#define LATCH_PIN 10        // also the hardware SS pin, which SPI.begin() drives low
#define OLED_CS_PIN 8
#define OLED_DC_PIN 9
#define W 128
#define PAGES 8
#define LED_COUNT 24
#define CHAIN_BYTES 3
#define BAR_PERIOD_US 20000UL   // 50 Hz, timed from micros()
#define OLED_PERIOD_MS 100UL    // 10 Hz, one page per tick
#define REPORT_PERIOD_MS 200UL  // 5 Hz
SPISettings kSettings(SPI_CLOCK_DIV4, MSBFIRST, SPI_MODE0);
uint8_t barFrame[CHAIN_BYTES], barShadow[CHAIN_BYTES], pageBuffer[W];
unsigned long lastBarUs = 0, lastOledMs = 0, lastReportMs = 0, lastLevelMs = 0;
unsigned long reportStartMs = 0, barFrames = 0, loopPasses = 0;
int barLevel = 8, verifyStep = 0, verifyMode = 1;
void latchFrame() { digitalWrite(LATCH_PIN, LOW); digitalWrite(LATCH_PIN, HIGH); }
void showBar(int level, int step, bool verify) {
  for (int i = 0; i < LED_COUNT; i++) {
    bool on = verify ? i == step % LED_COUNT : i < level;
    int byteIndex = CHAIN_BYTES - 1 - (i / 8);   // the first byte out lands furthest away
    int bitIndex = 1 << (7 - (i % 8));
    if (on) barShadow[byteIndex] |= (uint8_t)bitIndex;
    else barShadow[byteIndex] &= (uint8_t)~bitIndex;
  }
  for (int i = 0; i < CHAIN_BYTES; i++) barFrame[i] = barShadow[i];
  SPI.beginTransaction(kSettings);
  SPI.transfer(barFrame[0]); SPI.transfer(barFrame[1]); SPI.transfer(barFrame[2]);
  SPI.endTransaction();
  latchFrame();                                // exactly one pulse, after the last bit
}
void oledCommand(int command) {
  digitalWrite(OLED_CS_PIN, LOW); digitalWrite(OLED_DC_PIN, LOW);
  SPI.transfer(command); digitalWrite(OLED_CS_PIN, HIGH);
}
void oledInit() {                              // CS stays low across the whole sequence
  digitalWrite(OLED_CS_PIN, LOW); digitalWrite(OLED_DC_PIN, LOW); SPI.transfer(0xAE);
  SPI.transfer(0xD5); SPI.transfer(0x80); SPI.transfer(0xA8); SPI.transfer(0x3F);
  SPI.transfer(0xD3); SPI.transfer(0x00); SPI.transfer(0x8D); SPI.transfer(0x14);
  SPI.transfer(0xA1); SPI.transfer(0xC8); SPI.transfer(0xDA); SPI.transfer(0x12);
  SPI.transfer(0x81); SPI.transfer(0xCF);
  digitalWrite(OLED_CS_PIN, HIGH); oledCommand(0xAF);
}
void oledWritePage(int which) {
  for (int x = 0; x < W; x++) pageBuffer[x] = 0;
  // TODO: this ruler proves the page buffer reaches the glass. Replace it with the 5x7
  // font from exercise 3.1 and scroll one text row per tick.
  for (int x = 0; x < W; x += 8) pageBuffer[x] = 0xFF;
  if (which == 3) for (int i = 0; i < barLevel && 8 + i * 4 < W; i++) pageBuffer[8 + i * 4] = 0xFF;
  digitalWrite(OLED_CS_PIN, LOW); SPI.beginTransaction(kSettings);
  digitalWrite(OLED_DC_PIN, LOW); SPI.transfer(0xB0 | which); SPI.transfer(0x00); SPI.transfer(0x10);
  digitalWrite(OLED_DC_PIN, HIGH);
  for (int x = 0; x < W; x++) SPI.transfer(pageBuffer[x]);
  SPI.endTransaction(); digitalWrite(OLED_CS_PIN, HIGH);
}
void setup() {
  Serial.begin(115200);
  SPI.begin();
  pinMode(LATCH_PIN, OUTPUT);
  digitalWrite(LATCH_PIN, HIGH);   // a latch idles high, and SPI.begin() left it low
  pinMode(OLED_CS_PIN, OUTPUT); digitalWrite(OLED_CS_PIN, HIGH);
  pinMode(OLED_DC_PIN, OUTPUT); digitalWrite(OLED_DC_PIN, LOW);
  oledInit(); showBar(0, 0, false);
  reportStartMs = lastReportMs = millis();
  Serial.println(F("3.2 ready"));
}
void loop() {
  unsigned long nowMs = millis(), nowUs = micros();
  if (nowMs - lastLevelMs >= 1000UL) {            // TODO: the instrument's real input goes here
    lastLevelMs = nowMs; barLevel = (barLevel + 1) % (LED_COUNT + 1);
  }
  if (nowUs - lastBarUs >= BAR_PERIOD_US) {
    lastBarUs = nowUs; barFrames++; showBar(barLevel, verifyStep++, verifyMode != 0);
  }
  if (nowMs - lastOledMs >= OLED_PERIOD_MS) {
    lastOledMs = nowMs; oledWritePage((int)((nowMs / OLED_PERIOD_MS) % PAGES));
  }
  if (nowMs - lastReportMs >= REPORT_PERIOD_MS) {
    lastReportMs = nowMs;
    unsigned long elapsed = millis() - reportStartMs;
    if (elapsed == 0) elapsed = 1;
    Serial.print(F("bar ")); Serial.print(barFrames * 1000UL / elapsed);
    Serial.print(F(" Hz, loops/s ")); Serial.println(loopPasses * 1000UL / elapsed);
    barFrames = 0; loopPasses = 0; reportStartMs = millis();
  }
  loopPasses++;
}
```
**Functional Requirements**
- Refresh the bargraph at 50 Hz or better, timed from `micros()`, and report the measured rate at 5 Hz so the target is proven rather than assumed.
- Exactly one RCLK pulse per frame, after the last bit is in. Send all three bytes inside one `beginTransaction`/`endTransaction` pair, or byte by byte across loop passes — state which you chose and what it costs.
- Update one OLED page every 100 ms, so a full sweep takes 800 ms, and prove the bit pattern by walking a single LED from the package nearest D11 to the far end.
**Constraints**
- No bit-banging: `SPI` only, never `shiftIn`/`shiftOut`, and no `SPI.transfer()` inside an interrupt handler.
- No `delay()` anywhere; one RCLK pulse per frame; the framebuffer is a fixed-size array and never a `String`; D10 stays `OUTPUT` after `SPI.begin()`.

#### 6. Verification Checklist & Debugging Tasks
1. Power up in verify mode: the lit LED walks from the package nearest D11 to the far package, one position per frame. If it walks the other way, the framebuffer is not reversed — fix the code, not the wiring.
2. Switch `verifyMode` off: the bar fills and empties once a second, and no LED changes while a frame is being clocked in. Read the 5 Hz report: `bar` must be 50 or above.
3. Logic Analyser on SRCLK and RCLK: 24 rising clock edges per frame, then one narrow latch pulse, and nothing else.
4. Meter pins 8 and 16 of each 595 while the bar runs and record the ripple the 100 nF absorbs. Total LED current is $24 \times 3.1$ mA = 74.4 mA on the 5 V rail: confirm the rail does not sag, then repeat the whole board on an ESP32 DevKit V1 at 3.3 V and record what the LEDs do.
**Simulated Hardware Fault:**
**Symptom:** the third package's eight LEDs are frozen on whatever they showed at reset, and the first two work perfectly.

**Diagnosis:** (1) That package's RCLK is not connected, so it never latches — it is not frozen, it is still shifting, and its output latches never see a frame, so the LEDs show the reset state. (2) Meter each package's RCLK pin while a frame runs: all three must show the same narrow pulse, and two pulses with one flat line is the whole answer in a single reading. (3) Probe at the package's pin, not at the breadboard row, or you will measure the rail and call it fixed.

**Fix:** wire RCLK to all three packages. One missing wire is the entire fault.
**Variant B — all 24 LEDs flicker wildly every time the OLED redraws.** A 100 nF is missing on one or more shift registers, and the OLED's 128-byte page write is enough current step to ring the supply: fit all three, physically across pins 16 and 8 at each chip, not on the rail. **Variant C — perfect on the Uno, nonsense on the ESP32.** The 74HC595 needs $V_{IH} = 0.7 V_{CC} = 3.5$ V and 3.3 V logic does not reach it: use a 74HCT595 (fixed 2.0 V threshold), power the 74HC from 3.3 V (threshold 2.31 V), or put a real level shifter on SRCLK, SER and RCLK.

#### 7. Noesis Lab Twin
Parts by catalogue name: `128x64 OLED SPI module (SSD1306)` (id `ssd1306-128x64-spi`, header VCC/GND/CS/RST/D/C/DIN/CLK/VIN) or `2.4" TFT (ILI9341)` (id `ili9341-320x240`, header VCC/GND/CS/RST/D/C/DIN/CLK/LED), which shares the same eight-wire SPI footprint with far more pixels to move; board Uno R3 or ESP32 DevKit V1.
- **A different pin assignment from the bench, on purpose.** The twin recognises SPI on D10, D13 and D11 — and on **D9 as its data-select line** — so wire the module's CS to **D10** and its D/C to **D9**. The real Uno's D9 is not an SPI pin; in the twin it is the D/C wire. On the ESP32 the same four nets are GPIO5 (CS), GPIO15 (D/C), GPIO18 (SCK) and GPIO23 (MOSI). A display wired anywhere else never sees the bus and stays dark.
- **Two call changes and nothing else.** In the twin the D/C state travels with each byte: `SPI.transfer(value, 1)` for data, `SPI.transfer(value, 0)` for a command. Change `SPI.transfer(x)` to `SPI.transfer(x, 1)` inside `oledWritePage` and to `SPI.transfer(x, 0)` inside `oledInit`, and delete the `digitalWrite(OLED_DC_PIN, ...)` lines. `SPI.begin()`, `SPI.transfer()` and `SPI.end()` work, and the transfer the Bus Monitor logs runs from `SPI.begin()` (or `SPI.beginTransaction()`) to `SPI.end()`; `SPI.endTransaction()`, `setClockDivider`, `setBitOrder` and `setDataMode` are accepted and ignored, since the twin's bus is fixed at 8 MHz and 1 µs per byte. Every transfer logs time, bus, bytes and duration with its address column reading `null`, because SPI has no addressing to log — that single difference from 3.1 is the shape of the protocol.
- **Verifiable here:** the transaction layer, command/data framing, and chip-select framing on a real display part, which is where a mode-0 mistake or a command sequence split by a premature `SPI.end()` shows up as a blank or garbled panel; the `2.4" TFT (ILI9341)` moves 320 × 240 × 16 bits at the modelled 8 MHz, so a full-frame push is 153.6 ms of bus time the sketch genuinely waits out. **Bench-only:** the twin has no 74HC595 part, so the cascade, the latch discipline, the $I_{OL}$/$I_{tot}$ budget, decoupling, the MSB-first byte-order reversal and the 3.3 V $V_{IH}$ argument are all bench-only, and it models neither CPOL nor CPHA — a mode-1 sketch renders there and fails on the bench, so the Logic Analyser is not optional.
**A complete twin sketch** — the D/C state travels with the byte, and `SPI.end()` is the frame boundary the panel sees. Note the bare `SPI.begin()`: the twin accepts a zero-argument `SPI.beginTransaction()`, but real Arduino requires an `SPISettings` argument, so a twin sketch that uses one will not compile on the bench.
```cpp
void setup() {
  SPI.begin();
  SPI.transfer(0xAE, 0); SPI.transfer(0xAF, 0);
  SPI.transfer(0xB3, 1);
  for (int i = 0; i < 128; i++) SPI.transfer(0xFF, 1);
  SPI.end();
}
void loop() { }
```
Page 3 fills white if the mode-0 framing, the data flag and the command sequence are all right, and stays black if any one of them is wrong — which is the fastest way to tell a wiring fault from a framing fault.