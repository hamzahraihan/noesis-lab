# Module 5 — Networks

Module 5 is where the track leaves the Uno behind, and where programs stop
being the only thing on the board's schedule. 5.1 fetched map tiles and never
named the network that carried them; 5.2 moved the same idea onto a computer
that runs Linux. This lesson is the one that names it: a board that joins a
network, asks it a question, and listens for something nobody asked for.

The program in this lesson has two jobs and one loop. Everything hard about
networking on a microcontroller is in that sentence.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| 5.3 | A network desk: ask, listen, never wait | Intermediate | 60–75 mins |

Companion lesson: [5.1 — A map on a TFT](module-5-maps.md) is the same shape
from the other side. There, a picture arrived late and the loop waited for it;
here, two answers arrive independently and the loop may not wait for either.

---

### 5.3: A network desk: ask, listen, never wait

**Difficulty Level:** Intermediate
**Level:** 5
**Estimated Completion Time:** 60–75 mins
**New concepts:** 1. an answer arrives later — start it, check it, do not wait for it. 2. a name is a lookup that can fail, and every request settles as a body or a failure. 3. the network speaks first — a subscription delivers messages nobody asked for.

**Board:** ESP32 DevKit V1 · **Language:** C++

#### 1. Real-World Scenario

A workshop keeps one small screen above the door. It shows the time, because
everyone in a workshop argues about the time, and it shows the temperature of
the paint store, because the paint cares. The time comes from a time service
and the temperature from a sensor; neither is on the board and neither answers
when it is asked.

A controller that waits for the time, then reads the temperature, updates each
one as slowly as the other. A controller that waits for nothing keeps both
current, and that is the whole design.

#### 2. Hardware Inventory & Pinout Map

**Bill of materials**

| Qty | Part | Why |
| --- | --- | --- |
| 1 | `3.2" TFT (ILI9341)` | Shows both answers at once: one that was asked for, one that arrived. |
| 6 | Jumper wires | Three for the bus, two for power, one for data-or-command. |

**Pinout map**

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| `3V3` | `VCC` | the panel's supply | 3.3 V. The panel's logic is not 5 V tolerant. |
| `GND` | `GND` | the panel's ground | Both supply rails defined. |
| `D23` | `DIN` | panel data in | The board's SPI MOSI line. |
| `D18` | `CLK` | panel clock | The board's SPI SCK line. |
| `D5` | `CS` | chip select | Says this byte is for the panel. |
| `D15` | `D/C` | data or command | The same bus carries both; this line says which. |

There is no current arithmetic to show, and that is deliberate rather than an
omission: the panel is a **module**. Its backlight string and its regulator are
on the module's own board, and its datasheet is where those currents live —
`the bench does not model the panel's supply current, so this lesson does not
quote it`. What the bench does model is the seven-segment arithmetic of the
display itself: the framebuffer, the rotation, and the number of pixels the
sketch asked it to change.

#### 3. Circuit Schematics & Wiring Guide

```text
   ESP32 DevKit V1                     3.2" TFT (ILI9341)
   ───────────────                     ──────────────────
       3V3  ──────────────────────────────  VCC
       GND  ──────────────────────────────  GND
       D23  ──────────────────────────────  DIN     (MOSI)
       D18  ──────────────────────────────  CLK     (SCK)
        D5  ──────────────────────────────  CS
       D15  ──────────────────────────────  D/C

   The panel sits beside the board; the breadboard is not used.
```

**Wiring procedure**

1. Unpowered. Plug the panel's header into six jumpers, one per pin, in the
   order they appear on its header.
2. `3V3` to `VCC`, then `GND` to `GND`. Power first, because everything after
   this assumes the panel is alive.
3. `D18` to `CLK`, `D23` to `DIN`. The clock paces the bits; the data line
   carries them.
4. `D5` to `CS`, `D15` to `D/C`. These two are what make one wire into a bus.
5. Check the two 5 V-looking mistakes before powering: `VCC` is on `3V3`, not
   `5V`, and no jumper is on the panel's `LED` pin unless you intend to drive
   the backlight separately.

**Hardware Gotchas & Safety Rules**

- **The panel draws nothing and the serial monitor works.** Check `VCC` and
  `GND` first. A module with power and no ground has no return path.
- **The panel lights but shows noise or nothing at all.** `CS` and `D/C`
  swapped is the common cause: the panel takes command bytes as data and never
  gets a command.
- **A 5 V board with 3.3 V logic and a 5 V `VCC`.** The ESP32's `3V3` is the
  correct rail. On an Uno this panel would need level shifting, which is part
  of why this lesson runs on the ESP32.

#### 4. Embedded Concept Deep-Dive

**An answer arrives later.** A network call is not a function that returns a
value. It is a *process*: something is sent, the other end takes its time, and
the answer appears when it appears — tens of milliseconds here, seconds on a
bad link. A program that cannot wait (and from Level 2 onward it cannot) keeps
a small amount of state instead: a flag saying "one is out", and a check on
every pass. That flag is one integer. The rule it encodes is the whole lesson:

```text
start the request  →  waiting = 1
every pass         →  if waiting and get(...) == 1: read it, waiting = 0
```

**A name is a lookup that can fail.** `http://api.noesis/time` is a name and a
path. The network has to look the name up and find the path, and either step
can fail: an unknown name, a path nobody serves, or no connection at all. The
port therefore answers two questions, not one — *has it settled* (`get` returns
1) and *was it a body or a failure* (`failed()`). A program that treats both as
success prints an empty line and looks correct. Every request in this bench
settles: there is no request that waits forever, because a program waiting on
one is frozen rather than slow.

**The network speaks first.** Subscription is the other direction: the sensor
publishes a temperature once a second, whether or not anyone listens, and the
latest reading is held for whoever subscribes. `available()` answers whether
something has arrived since the last look; `message()` returns it. Nothing is
asked for, so nothing has to be started — but the check has to happen, on every
pass, or the message is missed. This is what makes the loop two jobs rather
than one: the sensor's arrival and the clock's answer are checked side by side,
and neither check costs anything when there is nothing to do.

**Timing, again.** Five seconds between requests is `millis() - lastAsk >=
ASK_EVERY_MS`, difference first. Written as `millis() >= deadline` it fails
once, quietly, forty-nine days in, when the counter wraps.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
/*
 * Exercise 5.3 -- A network desk: ask, listen, never wait.
 *
 * Hardware: ESP32 + 3.2" TFT on SPI (D23/D18/D5/D15 + 3V3/GND).
 * Bench: ESP32 DevKit V1. Twin: see section 7.
 *
 * Supplied: the join, the panel, the subscription, and the state variables the
 * two jobs need. What is missing is the loop's three checks -- the part that
 * makes this a network program rather than a drawing one.
 */

#include <WiFi.h>

#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREEN 0x07E0
#define SKY   0x867D

#define ASK_EVERY_MS 5000

int waiting = 0;              // 1 while a clock request is out
unsigned long lastAsk = 0;    // when the last one went out

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(1);
  tft.clear();
  tft.print("NETWORK DESK", 20, 20, SKY);

  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(50);
  }
  Serial.print("ip ");
  Serial.println(WiFi.localIP());

  Serial.print("subscribed ");
  Serial.println(net.subscribe("readings/temp"));

  net.get("http://api.noesis/time");
  waiting = 1;
  lastAsk = millis();
}

void loop() {
  // TODO 1: print and draw any temperature that has arrived.
  // TODO 2: when the clock request has settled, read it -- or report the
  //         failure -- draw it, and clear the flag.
  // TODO 3: every five seconds, start a new request. Reset first.
}
```

**Functional Requirements**

- The serial monitor prints `ip 192.168.4.10` once the join lands.
- It prints `subscribed 1`, and then one `temp <n.n>` line per second.
- It prints `time <iso-8601>` within the first second, and again every five
  seconds, each one a later second than the last.
- The panel shows the address, the time, and the latest temperature, each in
  its own band.
- Worst case: one request in flight at a time, one message per second, and a
  loop that never blocks.

**Constraints**

- **No `delay()` in `loop()`.** The whole exercise is that the loop keeps
  running. `delay` is allowed in `setup` — the join has nothing else to do.
- **No `while` around `net.get`.** A blocking wait on the answer starves the
  subscription.
- **One state flag.** `waiting` is the entire scheduler; do not add a second
  one for the sensor, because the sensor needs none.
- **Reset before re-asking.** A port asked for the same url twice answers from
  the request it already finished.
- **Wrap-safe timing:** `millis() - lastAsk >= span`, difference first.
- No `String`, no `struct`, no pointers — the sketch dialect is the
  interpreter's, and section 7 lists where it differs from the real compiler.

#### 6. Verification Checklist & Debugging Tasks

1. Watch the serial monitor from reset: `ip 192.168.4.10`, then `subscribed 1`,
   then a `temp` line a second.
2. Count ten `temp` lines. It should take about ten seconds, and the panel's
   temperature should change with them.
3. Watch the clock: two consecutive `time` lines are five seconds apart, and the
   second one is later than the first. If they are identical, the request was
   never restarted.
4. **Break it on purpose.** Replace the flag check with
   `while (net.get("http://api.noesis/time") == 0) { }`. The clock still
   updates; the temperature stops. The sensor never stopped publishing — the
   loop stopped asking.
5. Ask for `http://api.nowhere/time` instead. It settles as a failure: the
   serial prints `no answer`, and the loop keeps running. A network failure is
   data, not a hang.

**Simulated Hardware Fault:**

> **Symptom:** the panel shows the address and the first time, and then the
> temperature stops arriving. The serial monitor has one `temp` line. The
> program uploaded fine, and the bench says the board is running.

**Diagnosis**

1. **Is there a `while` around `net.get`?** It looks like the tidy way to wait
   for an answer and it is the bug. Replace it with the flag check.
2. **Is there a `delay` in the loop?** Even 50 ms is enough to drop the sensor's
   cadence to whatever the delay allows.
3. **Did the flag ever clear?** If `waiting` stays 1, the clock is checked
   forever and nothing else runs.
4. **Was `reset` called before the next ask?** Without it the old answer comes
   back with `1` and the flag clears off a request that was never made.
5. **Only then suspect the network.** The serial's `subscribed 1` says the
   subscription was accepted; the sensor's cadence is the bench's, not the
   board's.

**Fix:** keep the flag, remove the wait. If the answer is not in, the pass ends
and the next one checks again — the loop's whole cost when there is no news is
two integer comparisons.

**Variant B — the time stands still.** The temperature keeps coming, the clock
prints once and never changes. The request completed and `get` keeps answering
`1` from it; the sketch must `reset()` before asking again. This is the same
class of fault as Variant A with the opposite symptom: one starves the loop,
the other starves the request.

#### 7. Noesis Lab Twin

**Wiring:** ESP32 DevKit V1 · `3.2" TFT (ILI9341)` · `VCC`, `GND`, `DIN`,
`CLK`, `CS`, `D/C` to `3V3`, `GND`, `D23`, `D18`, `D5`, `D15`.

**What this twin verifies faithfully:** the two-job loop — the temperature
arriving while the clock request is out — the poll-and-flag shape, the failure
state, and the panel updating. The network itself is the bench's: `noesis-bench`
with the password `benchwifi`, `api.noesis` serving `/time` and `/hello`, and
the sensor publishing `readings/temp` once a second (retained, so the first
reading is waiting on the subscribe). Every answer arrives on *simulated* time,
so the same sketch behaves identically on every machine.

**What it cannot show, and what you lose:** the radio is not modelled at all —
no signal strength, no association timeout, no packet loss — so the join either
lands or is refused and never anything in between. There is no real internet:
a name the bench does not know fails immediately, and the CORS and TLS
constraints of a real browser do not exist here. The panel is driven through
the bench's `tft` layer rather than by your own SPI writes, so the six jumpers
are the bus a real panel would use but unwiring them does not blind the twin
(5.1 writes SPI itself and does notice). Timing is simulated, so a slow network
is a number in the simulator, not weather.

**A note on this sketch's dialect:** no `String`, no `struct`, no pointers, no
file-scope `const` (use `#define`), one declarator per declaration, and integer
division truncates. The sketch below is the complete answer and runs as pasted.

```cpp
#include <WiFi.h>

#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREEN 0x07E0
#define SKY   0x867D

#define ASK_EVERY_MS 5000

int waiting = 0;
unsigned long lastAsk = 0;

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(1);
  tft.clear();
  tft.print("NETWORK DESK", 20, 20, SKY);

  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(50);
  }
  Serial.print("ip ");
  Serial.println(WiFi.localIP());
  tft.print(WiFi.localIP(), 20, 50, WHITE);

  Serial.print("subscribed ");
  Serial.println(net.subscribe("readings/temp"));

  net.get("http://api.noesis/time");
  waiting = 1;
  lastAsk = millis();
}

void loop() {
  if (net.available()) {
    tft.fillRect(20, 200, 440, 40, BLACK);
    tft.print(net.message(), 20, 200, GREEN);
    Serial.print("temp ");
    Serial.println(net.message());
  }

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

  if (waiting == 0 && millis() - lastAsk >= ASK_EVERY_MS) {
    net.reset();
    net.get("http://api.noesis/time");
    waiting = 1;
    lastAsk = millis();
  }
}
```

### Going further

- **Publish, don't just subscribe.** `net.publish("commands/interval", "2")`
  asks the bench's sensor to publish every two seconds instead of every one.
  The order is accepted by the network, and the feed itself shows the effect —
  which is what publishing looks like when there is no second board to receive
  it.
- **Make the desk a clock that survives a failure.** Keep the last good time and
  mark it stale when a request fails, instead of blanking the band. What should
  the panel do when the network has been down for a minute?
- **Notice the cadence.** Print `millis()` beside each temperature and check the
  spacing. Then change the ask interval and see which half of the program is
  actually driving the rate.
