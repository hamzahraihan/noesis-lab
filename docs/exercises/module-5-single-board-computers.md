# Module 5 — Single-Board Computers

Everything so far has been a microcontroller: a chip that boots your sketch and does nothing else. A single-board computer is a different kind of object. It runs Linux, it has no analogue input, its pins are numbered by what they touch inside the chip rather than by where they sit, and it will happily destroy itself if you feed one of those pins 5 V.

Those are not trivia. They are the four things you cannot learn from an Uno, which is why this module exists.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| 5.2 | A pocket map on a TFT | Intermediate | 45–60 mins |

Companion lesson: [5.1 A map on a TFT, from OpenStreetMap](module-5-maps.md) is this module's other half — the same kind of picture, but fetched from a network and drawn on an ESP32.

---

### 5.2: A pocket map on a TFT
**Difficulty Level:** Intermediate
**Level:** 5
**Estimated Completion Time:** 45–60 mins
**Board:** Raspberry Pi 4 · **Language:** Python (gpiozero)

#### 1. Real-World Scenario

A handheld navigation unit for a walking trip. A 320×240 colour panel shows the route you are following, and a marker moves along it as you make progress. There is no GPS module here — that is deliberate, and the reason is the most useful fact in this module: **a Raspberry Pi has no analogue input at all.** If you want to read a position, a dial or a sensor on this board, you add an MCP3008 on the SPI pins and you pay for it in CS lines.

So position comes from a button, one press per waypoint. That is a real design decision made for a real reason, and the sketch is otherwise exactly what a GPS version would look like with different numbers in it.

#### 2. Hardware Inventory & Pinout Map

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| GPIO11 (physical 23) | TFT CLK | SPI0 clock | 8 MHz nominal |
| GPIO10 (physical 19) | TFT DIN | SPI0 MOSI | Data out to the panel |
| GPIO8 (physical 24) | TFT CS | SPI0 chip-select | **A pin of its own.** Share it and you have one panel |
| GPIO24 (physical 18) | TFT D/C | data/command | **Not a hardware pin.** An ordinary GPIO the program drives |
| 3V3 (physical 1) | TFT VCC | the 3.3 V rail | The panel is a 3.3 V device |
| GND (any) | TFT GND | ground | |
| GPIO4 (physical 7) | Tactile Button leg A | the button | gpiozero turns the pull-up on |
| GND (any) | Tactile Button leg B | ground | A press pulls the line down |

Bill of materials: Raspberry Pi 4; 2.4" ILI9341 TFT on the usual 8-pin SPI breakout; one tactile button; breadboard and jumpers. No resistors anywhere: the panel is 3.3 V, and the button relies on the pin's own pull-up.

> **The pin numbers are the whole trap.** `GPIO11` is physical pin 23. The program says 11; your finger finds 23. On an Uno the silkscreen and the firmware number agree. On a Pi they deliberately do not, because "pin 11" on a Pi is a different piece of silicon from "pin 11" on your breadboard.

#### 3. Circuit Schematics & Wiring Guide

Four wires to the panel, two to the button.

```
  Raspberry Pi 4                    2.4" TFT (ILI9341)
 ┌──────────────┐                  ┌──────────────┐
 │  GPIO11 (23) ├──────────────────┤ CLK          │
 │  GPIO10 (19) ├──────────────────┤ DIN  (MOSI)  │
 │  GPIO8  (24) ├──────────────────┤ CS           │
 │  GPIO24 (18) ├──────────────────┤ D/C          │
 │  3V3    (1)  ├──────────────────┤ VCC          │
 │  GND         ├──────────────────┤ GND          │
 └──────────────┘                  └──────────────┘
 │  GPIO4  (7)  ├──────┐
 │  GND         ├──────┴──┐
 └──────────────┘          │
                   ┌──────┴──────┐
                   │  BUTTON     │
                   └─────────────┘
```

Three of the four SPI lines come out of the peripheral. The fourth — D/C — does not, and that is worth noticing: it is a GPIO the program drives by hand, exactly as the Uno's D9 was in Module 3.

Chip-select is the one wire that must not be shared. Module 3 built an exercise around what happens when two panels hang off one select; the rule it taught is the rule this circuit depends on.

#### 4. Embedded Concept Deep-Dive

**SPI has no addresses.** A device is selected by a line and told nothing about who it is. Two devices sharing a select are not two devices — they are one byte stream with two readers, and each draws something different from the same bytes.

**The D/C line is one wire with two meanings.** Low means "this byte is a command"; high means "this byte is data". It is the only thing telling a panel apart from a picture full of bytes it would otherwise read as opcodes.

**The address window is why a display is fast.** Before it will accept pixels, the panel is told a rectangle: two commands, eight numbers. Everything after those eight bytes lands in that box and then the cursor steps on. So the panel does not have to be told to draw everywhere — and that is the difference between a display that can keep up and one that cannot.

**RGB565 is sixteen bits per pixel.** Five for red, six for green, five for blue. Green gets the extra bit because the eye resolves it best. Pack them in the wrong order and the picture comes out the *wrong colour* rather than no colour at all, which is a slower bug to find than a blank screen.

**The Pi's GPIO is 3.3 V and not 5 V tolerant.** A 5 V line into a Pi pin damages it. This is the single most expensive thing a beginner can do to one of these boards, and it is why the panel's VCC goes to 3V3.

**The outputs are weak.** The BCM2711 drives 8 mA at most, which is roughly 400 Ω of output impedance against an Uno's 25 Ω. The bench models this, so a jumper that comfortably lights an LED on an Uno barely registers here. That is the board's answer, not a fault.

**There is no analogue input.** Not a weak one — none. The Pi's GPIO bank is digital, and the SoC has no converter behind it at all. An MCP3008 over SPI is the usual answer, and it costs four chip-select lines to save a whole class of wiring.

#### 5. Firmware Challenge & Code Template

The program is gpiozero, the library a Pi actually uses. You build an object on a pin and then use it, which reads like the hardware rather than like a sequence of mode changes.

```python
from gpiozero import LED, Button
import time

CS = 8       # chip-select. A pin of its own: share it and you have one panel.
DC = 24      # data/command. Not a hardware pin at all, just an ordinary GPIO.
MOVE = 4     # the button that walks you along the route.

WIDTH = 320
HEIGHT = 240


def rgb565(red, green, blue):
    """Twenty-four bits down to the sixteen the panel takes.

    Five bits of red, six of green, five of blue. The eye is far more sensitive
    to green than to red, which is why green gets the extra bit. Pack them in
    the wrong order and the picture comes out the wrong colour rather than no
    colour at all, which is a slower bug to find than a blank screen.
    """
    return ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3)


SEA = rgb565(24, 52, 104)
LAND = rgb565(46, 104, 58)
ROAD = rgb565(238, 196, 92)
MARK = rgb565(255, 255, 255)
```

Two ideas carry the rest of it.

**A frame is bytes, and you choose the rectangle.** `start_window` names a box; `put` sends two bytes per pixel; `stop_window` closes it. `bar` and `fill` are just those three used once per row and once per rectangle.

**Colour is a number you compute.** `rgb565` is four lines long and it is the only place the display's colour format appears. Change it and every colour on the panel changes.

The route is a chain of waypoints in panel pixels. Nothing in the program knows what a *place* is — a map is a line between coordinates, and the coordinates are the only part that has to be right.

#### 6. Verification Checklist & Debugging Tasks

- [ ] **The panel lights and shows the sea.** If it is black, the wiring is wrong, or `0x29` never arrived. Check `command(0x29)` actually runs.
- [ ] **The land blocks appear.** If they are the colour of the sea, the window is landing somewhere else — check `0x2A` and `0x2B`, and check that `x0` reaches the panel before `x1` does.
- [ ] **The route is drawn.** If the road is missing but the land is there, `road()` is not stepping — check `steps` is never zero.
- [ ] **The marker sits on the first waypoint.** The serial monitor should read `waypoint 0 at 24,200`.
- [ ] **The marker moves.** Press the button; the serial line should change to the next waypoint and wrap after the sixth.

Now the experiment worth doing:

> **Shrink the water.** Change `fill(0, 0, WIDTH - 1, HEIGHT - 1, SEA)` to `fill(0, 0, 60, 60, SEA)` and run it again.
>
> The sea shrinks, and the rest of the screen keeps whatever it last held — because the program no longer writes those pixels, and **nothing on the panel ever goes back to blank on its own.** This is the most common bug in display code, and the only cure is knowing what your last frame actually covered.

And the fault injection:

> **Take the CS wire off GPIO8 and leave it loose.** Run it.
>
> The map is still there. A panel holds the last thing it was told and does not check whether it is still being spoken to. That is the honest answer to "why did my screen freeze": nothing broke, nothing reported, and no byte arrived.

#### 7. Noesis Lab Twin

Press **Put it on the bench** and the whole circuit is built for you — Pi, panel, button, jumpers — with the sketch already in the editor and the language selector already on Python.

Then:

1. Watch the Bus Monitor while it draws. Every byte of the sea is 320 × 240 × 2 = **153,600**, plus ten bytes of addressing per row.
2. Look at the frame cost in simulated time. At the 8 MHz the bench models, one full frame is about **150 ms**. That is the number that decides how a real program draws: not by animating smoothly, but by only ever redrawing what changed.
3. Open the logic analyser on MOSI and CLK and see the framing — command byte, then data bytes, then the next window.
4. Try the experiments above on the real bench. The Bus Monitor does not change when the CS wire does, because SPI has no acknowledge bit and no address to report a mistake through. That is what a select left unasserted looks like, and it is why nothing warns you before the hardware does.

---

### Going further

**Add an MCP3008 and read a real position.** It is an ADC that speaks SPI, and the Pi already has the pins for it. You will spend four chip-select lines and gain an analogue input back, which is the actual trade a Pi board makes: buses for converters.

**Draw the route from data rather than from code.** The waypoints are five numbers at the top of the file. Read them from a file, from a web page, from a serial line — the drawing code does not care at all, which is the point of separating the map from the map's *source*.

**Move the marker smoothly.** Right now it jumps a waypoint per press. Interpolate between waypoints with `int()` and it moves continuously, and you can watch the frame cost climb as a direct consequence of drawing more often.

**Use `PWMOutputDevice` for the marker.** A colour's brightness is a number between 0 and 1, so a faded marker is one extra `.value` — and it is how you would draw a real track instead of a binary one.
