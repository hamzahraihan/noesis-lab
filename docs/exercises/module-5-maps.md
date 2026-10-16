# Module 5 — Maps on a Screen

The first lesson to reach outside the board for its data. Everything before this drew what the program could work out for itself: a blink, a sampled voltage, a byte pushed at a display. A map is the other kind of thing — a picture that lives on someone else's server, arrives eventually rather than instantly, and changes the shape of the code that has to wait for it.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| 5.1 | A map on a TFT, from OpenStreetMap | Intermediate | 60–75 mins |

Companion lesson: [5.2 A pocket map on a TFT](module-5-single-board-computers.md) draws the same kind of picture on a board with an operating system under it — a Raspberry Pi, with the map walked by a button instead of fetched from a network.

---

### 5.1: A map on a TFT, from OpenStreetMap
**Difficulty Level:** Intermediate
**Level:** 5
**Estimated Completion Time:** 60–75 mins
**Board:** ESP32 DevKit V1 · **Language:** C++ (Arduino dialect)

#### 1. Real-World Scenario

A route display in a service van's cab. The panel shows where the van is, and the driver looks at it the way anyone looks at a map: briefly, and only when it has changed. The unit boots in a depot yard with no map stored anywhere inside it — the pictures are fetched, street by street, from the OpenStreetMap tile servers, and what the board actually holds is a handful of 256-pixel squares and a loop that keeps asking.

The failure this lesson is really about is the one every display in a vehicle has: it shows the last frame it was given and never mentions that it has stopped changing. A program that assumes the picture is already there draws yesterday's position with full confidence. So the map arrives when it arrives, the program waits for it honestly, and the learner finishes by breaking the fetch on purpose and watching the screen look exactly the same as a wiring fault.

Point it at your own street before you are done — that is two numbers in the sketch, and it is the moment the lesson stops being an exercise.

#### 2. Hardware Inventory & Pinout Map

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| GPIO23 | TFT DIN | SPI1 MOSI | Data out to the panel; fixed on the peripheral |
| GPIO18 | TFT CLK | SPI1 clock | Fixed on the peripheral |
| GPIO5 | TFT CS | chip-select | **The hardware SS line.** The sketch pulls it HIGH in `setup()` |
| GPIO15 | TFT D/C | data/command | **Not a bus line.** An ordinary GPIO the sketch drives |
| 3V3 | TFT VCC | the 3.3 V rail | The panel's logic and backlight are 3.3 V devices |
| GND | TFT GND | ground | |
| GPIO4 | Tactile Button leg A | west | Active-LOW, `INPUT_PULLUP`; no resistor anywhere |
| GND | Tactile Button leg B | ground | A press grounds the pin |
| GPIO13 | Tactile Button leg A | east | |
| GND | Tactile Button leg B | ground | |
| GPIO27 | Tactile Button leg A | turn the panel | Deliberately **not** a strapping pin |
| GND | Tactile Button leg B | ground | |

Bill of materials: ESP32 DevKit V1; one 3.2" ILI9341 TFT on the usual 8-pin SPI breakout (480×320); three tactile buttons; breadboard and jumpers. No resistors and no external pull-ups: the buttons ride on the pins' internal pull-ups, and the panel needs only power and its four lines.

> **Two voltages, one rule.** The panel runs at 3.3 V and so does every pin on this board — but the ESP32 is **not 5 V tolerant**. Only GPIO34–39 accept 5 V and they are input-only. A 5 V line into any other pin is a way to end the board, not a way to brighten a display.

> **Two of these pins are read before your program starts.** GPIO5 and GPIO15 are boot-strapping pins: at reset the chip samples them to decide how to come up. Here both are outputs the sketch drives immediately, which is fine — but buttons do not go there. A key that grounds a strapping pin can be read as held at boot, which is why the rotate key lives on GPIO27 and not somewhere tidier.

#### 3. Circuit Schematics & Wiring Guide

Six wires to the panel, three to the buttons.

```text
  ESP32 DevKit V1                    3.2" TFT (ILI9341)
 ┌────────────────┐                 ┌──────────────────────┐
 │  GPIO23 (MOSI) ├─────────────────┤ DIN                  │
 │  GPIO18 (SCK)  ├─────────────────┤ CLK                  │
 │  GPIO5  (SS)   ├─────────────────┤ CS                   │
 │  GPIO15        ├─────────────────┤ D/C   ordinary GPIO  │
 │  3V3           ├─────────────────┤ VCC   3.3 V only     │
 │  GND           ├─────────────────┤ GND                  │
 └────────────────┘                 └──────────────────────┘

    GPIO4  ──┬──[ WEST   ]──┐
    GPIO13 ──┼──[ EAST   ]──┼── GND
    GPIO27 ──┴──[ ROTATE ]──┘
```

Three of the panel's four lines come out of the SPI peripheral. The fourth — D/C — does not, and that is worth noticing: it is a pin the program drives by hand, exactly as the Uno's D9 was in Module 3. It is the only way the panel can tell a window command apart from a colour.

**Wiring procedure**

1. Power first, mentally: VCC to 3V3, GND to ground. Not 5 V, not ever.
2. The four panel lines: GPIO23 → DIN, GPIO18 → CLK, GPIO5 → CS, GPIO15 → D/C. Check both ends — the breakout labels them, but the order on those modules is not standard, so read the board rather than a photo of a board.
3. The buttons: one leg to its pin, the other to ground. Nothing between. West and east pan; the third turns the panel.
4. Before powering up, trace CS specifically: it is the one wire whose failure looks like a dead panel *and* like a frozen one, depending on when it comes loose.

**Hardware Gotchas & Safety Rules:**

- **5 V anywhere near a GPIO ends the board.** The panel wants 3.3 V and so does the chip; there is no 5 V row in this circuit at all. If a jumper reaches for VIN because VCC "needs more power", it is on the wrong pin.
- **A wrong D/C level gives a lit panel that never draws.** Every colour byte is read as a command, unknown opcodes are discarded without a word, and the screen stays dark with the serial monitor reporting progress. Nothing can be seen on the bus either — the bytes go out unchanged.
- **A loose CS freezes the picture.** The controller ignores everything while its select is unasserted (the twin models this), so the panel holds its last frame and no byte is reported anywhere. "The screen froze" and "the wire came loose" are the same picture, and the wires are cheaper to check.
- **A button on a strapping pin acts at boot.** GPIO0, 2, 5, 12 and 15 come up in special states; a key that grounds one can make the board come up wrong or be read as held. Keep buttons away from them — the rotate key's GPIO27 is there for this reason, not by accident.
- **The panel is a 3.3 V device with its own regulator on some breakouts.** If yours has a 5 V pin and an onboard regulator, the jumper still goes to 3V3: feeding the module 5 V on the "logic" pin is what kills boards.

#### 4. Embedded Concept Deep-Dive

**A map is a grid, and a tile is three numbers.** At zoom `z` the world is cut into `2^z` columns and `2^z` rows of square tiles; each tile is 256 pixels a side and is addressed `(z, x, y)`. Longitude is a plain fraction of the way round the world:

$$x = \left\lfloor \frac{\lambda + 180}{360} \cdot 2^z \right\rfloor$$

so `tileX()` is a divide and nothing else. Each step in zoom doubles the grid, which is why zoom 16 is a city and 19 is a street. At London's latitude a zoom-16 tile covers about **380 m** across (about 600 m at the equator — the same tile is wider on the ground the nearer the equator it is).

**Latitude is the hard one, and it is called Mercator.** A sphere does not unroll into a square sheet, so the projection stretches the latitudes until it does — the `sin()` and the `log()` in `tileY()`:

$$y = \left\lfloor \left(0.5 - \frac{\ln\frac{1+\sin\phi}{1-\sin\phi}}{4\pi}\right) \cdot 2^z \right\rfloor$$

That stretch is why Greenland looks the size of Africa and why **nothing near either pole is any use on a flat map** — at 90° the expression is infinite. The two lines in `tileY()` that hold the result inside `0 … 2^z - 1` are the edge of the world, and they are load-bearing: without them the program asks for a tile row that does not exist, and a wrong tile number is indistinguishable from a dead network from inside the sketch.

**The picture is never there when you ask for it.** This is the difference between a map program and every drawing program before it. `map.request()` starts a fetch and tells you whether the tile is already here; `map.ready()` is true once every request has *settled* — arrived, or given up on. The loop's honest position is: if nothing is ready, wait; otherwise draw what arrived and skip what did not. A program that insists on every tile before drawing anything stalls on the slowest tile forever; one that never gives up on a refused tile stalls forever full stop. The twin's tile store is built so a tile that will never come is recorded as *settled*, not as *pending*, so the wait can end — a deadlock, not a wait, is the failure mode this design exists to prevent.

**Drawing happens in whole tiles, not pixel by pixel.** `map.blit()` copies a finished 256×256 block of pixels into a rectangle; Module 3's OLED pushed bytes one at a time and let the controller assemble them, and a tile is the other arrangement: the assembly happened off-board, and the bus only carries the finished thing.

**Rotation is the chip's own business.** `tft.setRotation()` writes MADCTL, which tells the controller how to walk its own memory — so the same glass is 480×320 one way up and 320×480 the other, and `tft.width()` changes. The reach has to be worked out again after every turn, from the panel rather than from a number written down, because a number written down is right for exactly one orientation.

**Ask twice, pay once.** `map.request()` for a tile already in the cache is free — no bytes on the Bus Monitor, no second download. That is why panning back and forth feels instant after the first pass, and it is why the sketch asks for a generous area around the centre rather than the bare minimum.

**Integer division, and why the sketch uses `idiv()`.** In this dialect `/` truncates like C integer division, and a reach with a fractional part walks the request loop to *fractional* tile addresses — `32739.625` and `21789.625` are not tiles, nothing comes back for them, and the panel stays black while the serial monitor cheerfully reports a perfectly valid centre. `idiv()` is the integer divide the exercise wants.

**The credit line is not decoration.** The tile servers are run by volunteers, and their policy says any client that shows their tiles says where they came from. The sketch draws `(C) OpenStreetMap contributors` on every frame, and measures the strip it sits on so it survives a rotation. A lesson asking for a handful of tiles is exactly the kind of client that policy is written for — politely.

#### 5. Firmware Challenge & Code Template

The twin's editor carries the finished program, and it is worth reading in full before you change it — the projection, the request loop and the wait are all hand-written and all commented. This is the shape of it:

**Starter Code Scaffold**

```cpp
/* Exercise 5.1 -- a map on a 3.2" TFT, drawn from OpenStreetMap tiles.
 *
 * The board has no map in it and no way to draw one on its own. What it has
 * is a way to ask for a picture and a way to show one.
 */
#define TFT_CS   5
#define TFT_DC   15
#define BTN_WEST   4
#define BTN_EAST  13
#define BTN_ROTATE 27

#define WIDTH  480
#define HEIGHT 320
#define TILE   256

#define LATITUDE   51.5067
#define LONGITUDE  -0.1427
#define ZOOM       16

int centreX = 0;        /* the tile the screen is centred on */
int centreY = 0;
bool fetching = false;
int reachX = 1;         /* how far the view reaches either side */
int reachY = 1;

/* --- Supplied: the projection --------------------------------------------- */
int tileX(double lon, int z) {          /* longitude: a plain fraction */
  int n = 1 << z;
  int x = floor((lon + 180.0) / 360.0 * n);
  if (x < 0) x = 0;
  if (x > n - 1) x = n - 1;
  return x;
}

int tileY(double lat, int z) {          /* latitude: stretched first */
  int n = 1 << z;
  double rad = lat * PI / 180.0;
  double s = sin(rad);
  int y = floor((0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * PI)) * n);
  if (y < 0) y = 0;
  if (y > n - 1) y = n - 1;
  return y;
}

/* --- Supplied: one request per tile the screen needs ----------------------- */
void requestArea() {
  for (int dy = -reachY; dy <= reachY; dy++) {
    for (int dx = -reachX; dx <= reachX; dx++) {
      map.request(ZOOM, centreX + dx, centreY + dy);
    }
  }
}

void setup() {
  Serial.begin(115200);
  /* panel up: sleep out (0x11), display on (0x29) */
  applyRotation(1);                     /* sideways, how a map is read */
  reachX = idiv(tft.width() + TILE / 2, TILE);
  reachY = idiv(tft.height() + TILE / 2, TILE);
  /* buttons: active low, INPUT_PULLUP */
  centreX = tileX(LONGITUDE, ZOOM);
  centreY = tileY(LATITUDE, ZOOM);
  Serial.print("centred on tile ");
  Serial.print(centreX);
  Serial.print(",");
  Serial.println(centreY);
  requestArea();
  fetching = true;
}

void loop() {
  /* The wait: nothing can be drawn until the requests have settled. */
  if (!map.ready()) { delay(20); return; }

  if (fetching) {
    drawArea();                         /* blit what arrived, skip the rest */
    fetching = false;
    Serial.println("map drawn");
  }

  /* One tile east or west of here, if a button is down. */
  if (held(BTN_WEST) || held(BTN_EAST)) {
    delay(250);                         /* a press, not a hold */
    centreX = centreX + (held(BTN_EAST) ? 1 : -1);
    requestArea();
    fetching = true;
    Serial.print("moved to tile ");
    Serial.println(centreX);
  }

  /* A quarter turn: the reach must be worked out again afterwards. */
  if (held(BTN_ROTATE)) {
    delay(250);
    tft.setRotation((tft.width() > tft.height()) ? 0 : 1);
    tft.clear();
    reachX = idiv(tft.width() + TILE / 2, TILE);
    reachY = idiv(tft.height() + TILE / 2, TILE);
    requestArea();
    fetching = true;
    Serial.print("rotated to ");
    Serial.print(tft.width());
    Serial.print("x");
    Serial.println(tft.height());
  }

  delay(20);
}
```

**Functional Requirements**

- On boot the serial monitor prints `centred on tile 32742,21792` and, once the fetch settles, `map drawn`. The gap between the two lines is the network, and it is the lesson.
- The panel shows real streets. A tile that has not arrived is skipped rather than waited for, so the map fills in from the middle outwards — on a real board that is the difference between a map and a blank screen with a spinner.
- East or west prints `moved to tile 32743` / `32741` and shifts the picture by exactly one whole tile.
- The rotate key prints `rotated to 320x480` (and `480x320` on the next press), and the same streets come back re-fitted to the new shape. The reach is recomputed from the panel every time.
- Panning back over a tile already seen costs nothing: the Bus Monitor stays empty and the tile does not appear twice.
- The credit line `(C) OpenStreetMap contributors` is drawn on every frame, on a strip wide enough for the longest of the two orientations. Worst case is a full redraw after a rotation: fifteen tile requests, of which nine draw.

**Constraints**

- **Integer tile addresses only.** `idiv()`, never a reach with a fractional part — a tile request at `32739.625` is a request the world cannot answer.
- **The reach comes from the panel.** `tft.width()` and `tft.height()`, recomputed after every rotation. Writing the count down makes it right for exactly one orientation.
- **The wait has to be able to finish.** Design for the tile that never comes: a refused tile must settle, not stay pending, or the program waits forever over pictures that arrived perfectly.
- **One centre, one fetch at a time.** Panning moves `centreX` by exactly one and re-requests; there is no second source of position in the program.
- **The credit line always draws.** Attribution is the tile server's terms, not your choice.
- This is the track's one sanctioned blocking wait: while the picture is on its way the program genuinely has nothing to draw, so `delay(20)` in this loop is the honest tool. The no-`delay()` rule from Module 1 stands everywhere else.

#### 6. Verification Checklist & Debugging Tasks

1. **The panel lights, then the streets arrive.** Serial should show `centred on tile 32742,21792`, and `map drawn` a moment later; then look — that tile is Green Park, and it should be there in front of you.
2. **Watch the fill order.** Tiles land in the middle of the screen first and spread outwards, because `drawArea()` skips what has not arrived instead of waiting. If the map appears all at once at the very end, the loop is insisting on everything before drawing anything.
3. **Count a pan.** Press east once: `moved to tile 32743`, and the picture shifts by exactly one tile. West gives `32741`. Hold the button down and it should still only move once — the 250 ms read is a press, not a hold.
4. **Turn it.** Rotate prints `rotated to 320x480`, the glass clears, and the same streets come back fitted to the taller shape. Rotate again for `480x320`. If a band of undrawn glass appears down one side, the reach was not recomputed after the turn.
5. **Pan back and watch the Bus Monitor.** It stays empty: the tile was already downloaded, and asking for it twice is not a second request.
6. **Re-point it.** Set `ZOOM` to 18 — the map steps in twice (each zoom step doubles), same streets, finer detail. Set `LONGITUDE` and `LATITUDE` to your own street and the screen jumps. Then set them to a place on the coastline and watch the land/sea boundary in the tiles — a map you can point anywhere is the whole point of the tile scheme.
7. **Break it on purpose** — the CS experiment below — and then the offline test: pull the machine's network connection and run again.

**Simulated Hardware Fault:**

> **Symptom:** The map has been drawing fine, and then the screen simply stops changing. It still shows the last streets it drew — no clearing, no smear — while the serial monitor keeps announcing `moved to tile …`. Nothing anywhere reports a problem.

**Diagnosis**

1. **Check the CS jumper first** — GPIO5 to the panel's CS. The controller ignores every byte while its select is unasserted, so the panel holds its last frame and nothing on the bus reports the silence: SPI has no acknowledgement bit and no address to fail an answer through.
2. Reseat the other three panel lines while you are there. A blit needs DIN, CLK, CS and D/C all live; the frozen picture points at the bus, not the program.
3. **Compare the two monitors.** The serial says the program is alive and computing; the screen says the bus is not delivering. When those two disagree, the fault is electrical and no amount of re-reading the sketch will find it.
4. Only then suspect the code — and note that code faults look different here: a wrong window smears or shifts the picture rather than freezing it. A clean freeze with a lively serial is a wire.
5. **Distinguish the two CS faults by when they happen.** Loose before power-up: the panel never lights at all (0x29 never arrived). Loose after a frame: the picture freezes at that frame. Same wire, two symptoms — which is why you check it before blaming anything else.

**Fix:** Reseat CS. Then adopt the rule the lesson is trying to teach: for any "frozen" display, check the wires before the code — a panel's silence is the default state of a display nobody is talking to.

**Variant B — no network.** Pull the internet connection and run it. The panel lights, the serial prints the centre tile and then `map drawn`, and the screen shows nothing but the credit strip. Every tile failed; the tile store recorded each failure as *settled* rather than leaving it pending, so the wait finished and the program drew the holes. A network outage that presents as a black screen with a perfectly happy serial monitor is this lesson's other half: the fetch and the wiring fail with the same face.

#### 7. Noesis Lab Twin

Press **Put it on the bench** and the whole circuit is built for you — ESP32, 3.2" panel, three buttons, jumpers — with the sketch already in the editor.

**Wiring:** ESP32 DevKit V1 · `3.2" TFT (ILI9341)` · three `Tactile Button` · breadboard

**What this twin verifies faithfully:** the tile arithmetic — checked against the live tile server, which is where `16/32742/21792` comes from; the request/blit/wait loop, with the browser playing the radio and the tiles coming from a real OpenStreetMap mirror; the blit and the rotation (turning the panel re-reads the same memory, so the picture moves rather than disappears); the cache (a second ask is free); and the tile store's ability to end the wait when a tile never comes.

**What it cannot show, and what you lose:** there is no Wi-Fi stack, no TLS, no HTTP — the `map` object stands in for the radio, and `tft` stands in for the display library, so you write against their shape rather than against a real fetch. Server policy is not modelled either: on real hardware your client must identify itself and must not hammer the servers, and the browser cannot set the header that asks for that. RAM is not modelled: this panel holds its own pixels, whereas a real driver is where your framebuffer budget goes.

**A note on this sketch's dialect:** no `const` at file scope (use `#define`), no structs or enums, and `/` truncates like C integer division — which is why the sketch calls `idiv()` for the reach. The `map` and `tft` objects are the bench's supplies; write against them as you would against a real library.

---

### Going further

**Draw yourself onto the map.** The tile arithmetic has a second half — where inside a tile a coordinate lands, in pixels. That is how a marker sits between tiles instead of on one of them, and it is how a real tracker draws "you are here" rather than "you are in this square".

**Be a good client.** Read the OpenStreetMap tile usage policy properly — identify your client, cache politely, never fetch the same picture twice. The exercise's cache already does the third one; the first two are on you when you move this to real hardware, and getting them wrong is how a hobby project gets a server blocked.

**Port it to hardware.** A real build is an ESP32 with Wi-Fi credentials, a real TFT library, and an HTTP fetch that decodes PNG tiles — a genuinely harder program than the twin's, and it is the twin's loop that will still be sitting in the middle of it. The sketch's `map.request`/`map.ready`/`map.blit` is that program's shape; the twin just hands you the radio pre-configured.

**Try the pocket version.** [5.2](module-5-single-board-computers.md) is the same picture on a Raspberry Pi, with the map drawn from code rather than fetched — worth doing next, because the contrast (a picture you made versus a picture you asked for) is the argument of this whole module.
