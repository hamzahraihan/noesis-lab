/**
 * Module 5 — Single-board computers.
 *
 * The first module written for something that is not a microcontroller, and
 * that is the whole reason it exists. A Raspberry Pi runs Linux rather than a
 * sketch, its pins are numbered BCM rather than by position, it has no analogue
 * input at all, and its outputs are an order of magnitude weaker than an Uno's.
 * Every one of those is a constraint you can only learn by being blocked by it,
 * which is what this module is for.
 */

import { PART_STEP, PART_X, PART_Y, part } from './shared';
import type { Exercise } from '../exercises';

/**
 * The route, as waypoints in panel pixels.
 *
 * Nothing here knows what a place is. A map is a line between coordinates, and
 * the coordinates are the only part that has to be right -- which is the same
 * thing a real navigation program does, except a real one reads them off a GPS
 * instead of a table at the top of the file.
 */
const SKETCH = `# A pocket map on a TFT, driven from a Raspberry Pi's SPI0.
#
# The panel is 320 x 240. Every number below is in those pixels, and every
# pixel is two bytes: that is the whole of what a picture is, once the
# hardware has been pointed at the right rectangle.
from gpiozero import Button
import time

# SPI0, by the BCM numbers a program names rather than by position on the
# board. A pin number here is what you write in a program; the physical pin
# is what you look for when you are wiring.
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


def command(code):
    """One command byte on its own.

    The D/C pin is what says which it is: low for a command, high for data.
    One wire, two meanings, and a panel that reads a colour as a command is a
    panel that does something you did not ask for.
    """
    SPI.beginTransaction()
    SPI.transfer(code, 0)
    SPI.end()


def start_window(x0, y0, x1, y1):
    """Open the rectangle the next pixels land in.

    Two commands and eight numbers, and everything after them lands inside the
    box this names. The window is the reason a display can be faster than
    "redraw everything": you tell it where to draw, and then only send that.
    """
    SPI.beginTransaction()
    SPI.transfer(0x2A, 0)          # column address
    SPI.transfer(x0 >> 8, 1)
    SPI.transfer(x0 & 255, 1)
    SPI.transfer(x1 >> 8, 1)
    SPI.transfer(x1 & 255, 1)
    SPI.transfer(0x2B, 0)          # page address
    SPI.transfer(y0 >> 8, 1)
    SPI.transfer(y0 & 255, 1)
    SPI.transfer(y1 >> 8, 1)
    SPI.transfer(y1 & 255, 1)
    SPI.transfer(0x2C, 0)          # write memory: pixels may now follow


def stop_window():
    """Ending the transaction is what tells the panel the burst is over.

    Raise chip-select halfway through a command and the panel abandons it,
    exactly as the real controller does. That is why the window and the pixels
    it describes travel together.
    """
    SPI.end()


def put(colour):
    """One pixel. RGB565 arrives high byte first."""
    SPI.transfer(colour >> 8, 1)
    SPI.transfer(colour & 255, 1)


def bar(x0, y, x1, colour):
    """One horizontal run of pixels, which is what a window is really for.

    A panel is far quicker when it is told where to draw than when it is told
    to draw everywhere, and this is that idea at its smallest: name the run,
    send only those pixels, close it. Each row of a rectangle gets its own
    window rather than sharing one enormous one, which costs a few more bytes
    of addressing and saves a framebuffer's worth of guessing.
    """
    start_window(x0, y, x1, y)
    for x in range(x0, x1 + 1):
        put(colour)
    stop_window()


def fill(x0, y0, x1, y1, colour):
    """A rectangle of a single colour, which is every shape here."""
    for y in range(y0, y1 + 1):
        bar(x0, y, x1, colour)


def road(ax, ay, bx, by, colour):
    """One leg of the route, stepped rather than drawn.

    The line is walked a square at a time. At this size a road is a few pixels
    wide, and a line thin enough to vanish between two pixels would be no use
    to anyone trying to follow it.
    """
    steps = abs(bx - ax)
    if abs(by - ay) > steps:
        steps = abs(by - ay)
    if steps == 0:
        steps = 1
    for i in range(steps + 1):
        x = ax + int((bx - ax) * i / steps)
        y = ay + int((by - ay) * i / steps)
        fill(x, y, x + 3, y + 3, colour)


# The route, leg by leg.
R0X = 24;  R0Y = 200
R1X = 70;  R1Y = 140
R2X = 140; R2Y = 170
R3X = 200; R3Y = 110
R4X = 270; R4Y = 130
R5X = 300; R5Y = 60


def draw_map():
    """The sea, the land, and the road across it.

    This is the expensive half of the program and it is also most of what
    there is: a full-screen rectangle is 320 x 240 pixels, which is 153,600
    bytes on the wire, which at 8 MHz is about 150 ms. That number is the
    lesson. It is why a real program redraws only what it changed, and why a
    320x240 screen is nothing like as slow as a 1920x1080 one would be.
    """
    fill(0, 0, WIDTH - 1, HEIGHT - 1, SEA)
    fill(16, 16, 104, 104, LAND)
    fill(152, 24, 248, 88, LAND)
    fill(56, 152, 200, 232, LAND)
    fill(232, 116, 312, 200, LAND)

    road(R0X, R0Y, R1X, R1Y, ROAD)
    road(R1X, R1Y, R2X, R2Y, ROAD)
    road(R2X, R2Y, R3X, R3Y, ROAD)
    road(R3X, R3Y, R4X, R4Y, ROAD)
    road(R4X, R4Y, R5X, R5Y, ROAD)


pinMode(CS, OUTPUT)
pinMode(DC, OUTPUT)
digitalWrite(CS, 1)
digitalWrite(DC, 0)

command(0x11)   # sleep out
command(0x29)   # display on

button = Button(MOVE)

mx = R0X
my = R0Y
step = 0

def show():
    """Put the map and the marker on the panel as one frame.

    Drawn before the wait rather than after it, so the panel *holds* a finished
    frame while nobody is pressing anything. A program that redraws and then
    immediately blocks looks identical on screen and costs the same either
    way -- but drawing first means what you see is a picture the program
    finished, not one it is halfway through.
    """
    draw_map()
    fill(mx - 5, my - 5, mx + 5, my + 5, MARK)
    print("waypoint " + str(step) + " at " + str(mx) + "," + str(my))


show()

while True:
    button.wait_for_release()
    button.wait_for_press()

    step = step + 1
    if step > 5:
        step = 0

    if step == 0:
        mx = R0X
        my = R0Y
    elif step == 1:
        mx = R1X
        my = R1Y
    elif step == 2:
        mx = R2X
        my = R2Y
    elif step == 3:
        mx = R3X
        my = R3Y
    elif step == 4:
        mx = R4X
        my = R4Y
    else:
        mx = R5X
        my = R5Y

    show()
`;

/**
 * The exercise.
 *
 * `board` and `language` are what make this the first lesson that is not an
 * Uno lesson. Everything else about it -- the wiring table, the parts list, the
 * hints -- is the ordinary shape, because the exercise machinery is what is
 * meant to be portable even when the board is not.
 */
const POCKET_MAP: Exercise = {
  id: '5.2',
  title: 'A pocket map on a TFT',
  level: 5,
  module: 'Module 5 — Single-Board Computers',
  difficulty: 'Intermediate',
  minutes: '45–60 mins',
  brief:
    'Put a 320×240 colour display on a Raspberry Pi and draw a map of a route on it, ' +
    'then walk a marker along that route one waypoint at a time. Nothing here is a ' +
    'picture file: every pixel is two bytes pushed across SPI, and the map is code ' +
    'that decides which two. You finish with a program that draws, and with a clear ' +
    'idea of what a frame costs and why that number decides how real programs draw.',
  concepts: [
    'SPI on a single-board computer, and the four wires it needs',
    'A data/command line: one pin with two meanings',
    'The address window, and why it is the whole reason a display is fast',
    'RGB565, and why five/six/five',
    'gpiozero inputs, and the pull-up that makes a button readable',
    'That a Pi has no analogue input, and what you do instead',
    'What a full frame costs in bytes and in milliseconds',
  ],
  board: 'raspberry-pi',
  language: 'python',
  parts: [
    { name: '2.4" TFT (ILI9341)', qty: 1, why: 'The thing the map is drawn on. 320×240 pixels of it.' },
    { name: 'Tactile Button', qty: 1, why: 'How you move. A Pi cannot read a knob, so this is the input.' },
  ],
  wiring: [
    { pin: 'GPIO11', part: '2.4" TFT (ILI9341)', terminal: 'CLK', goesTo: "SPI0's clock, physical pin 23" },
    { pin: 'GPIO10', part: '2.4" TFT (ILI9341)', terminal: 'DIN', goesTo: "SPI0's data line, physical pin 19" },
    { pin: 'GPIO8', part: '2.4" TFT (ILI9341)', terminal: 'CS', goesTo: 'chip-select, physical pin 24 — a pin of its own' },
    { pin: 'GPIO24', part: '2.4" TFT (ILI9341)', terminal: 'D/C', goesTo: 'data/command, physical pin 18 — an ordinary GPIO' },
    { pin: '3V3', part: '2.4" TFT (ILI9341)', terminal: 'VCC', goesTo: "the Pi's 3.3 V, physical pin 1" },
    { pin: 'GND', part: '2.4" TFT (ILI9341)', terminal: 'GND', goesTo: 'any ground pin' },
    { pin: 'GPIO4', part: 'Tactile Button', terminal: 'a', goesTo: 'one leg of the button' },
    { pin: 'GND', part: 'Tactile Button', terminal: 'b', goesTo: 'the other leg — a press pulls the line down' },
  ],
  steps: [
    'Read the wiring table twice before you pick anything up, because every number in ' +
      'it is a BCM number and none of them is a position. GPIO11 is physical pin 23 on ' +
      'this board, and the silkscreen beside it says GPIO11 while the header counts it ' +
      'as 23. The program names one and your finger finds the other.',

    'Wire the four SPI lines: GPIO11 to CLK, GPIO10 to DIN, GPIO24 to D/C, GPIO8 to CS. ' +
      'Three of those come out of the SPI peripheral and the fourth does not — D/C is an ' +
      'ordinary GPIO the program drives by hand, exactly as the Uno’s D9 was in Module 3.',

    'Power the panel from 3V3, not 5V, and give it a ground. The Pi’s GPIO is 3.3 V and ' +
      'is not 5 V tolerant: a 5 V line into a Pi pin is a way to end the board, not a way ' +
      'to make the display brighter.',

    'Give the TFT its own chip-select on GPIO8. This is the wire Module 3 was about. Two ' +
      'panels on one select are not two panels; they are one byte stream with two readers, ' +
      'and each of them draws something different from the same bytes.',

    'Wire the button: one leg to GPIO4, the other to ground. Nothing else — no resistor. ' +
      'gpiozero turns the pin’s pull-up on for you, which is the same reason Module 1’s ' +
      'button needed no resistor either. A button on a pulled-up line reads high until ' +
      'you press it, and that is what is_active_low means.',

    'Press Run. The panel lights, the map appears, and the serial monitor says ' +
      '"waypoint 0". The screen is not showing a picture that was stored somewhere — ' +
      'it is showing what this program has pushed at it so far.',

    'Press the button. The marker moves to the next waypoint. Each press costs a whole ' +
      'frame, about 150 ms of simulated time, and the serial monitor tells you where you ' +
      'are. Keep pressing and it wraps back to the start.',

    'Now the experiment worth doing. Change fill(0, 0, WIDTH - 1, HEIGHT - 1, SEA) to ' +
      'fill(0, 0, 60, 60, SEA) and run it again. The water shrinks, and the rest of the ' +
      'screen keeps whatever it had last held — because the program no longer writes ' +
      'those pixels, and nothing on the panel ever goes back to being blank on its own. ' +
      'That is the single most common bug in display code, and the only cure is knowing ' +
      'what your last frame actually covered.',

    'Take the CS wire off GPIO8 and leave it loose. Run it. The map is still there, ' +
      'because a panel holds the last thing it was told and does not check whether it is ' +
      'still being spoken to. That is the honest answer to "why did my screen freeze": ' +
      'nothing broke, nothing reported, and no byte arrived.',
  ],
  solution: {
    approach: [
      'Decide which of the two numbers on the header you are wiring, because on this ' +
        'board they disagree. Every number in the table is a BCM number — what the pin ' +
        'is attached to inside the chip — and none of them is a position: GPIO11 is ' +
        'physical pin 23, and the silkscreen beside that hole says GPIO11 while the ' +
        'header counts it as 23. The program only ever names BCM, so the translation ' +
        'happens once, at the table, before anything is picked up.',
      'Decide the supply before the signals. The Pi’s pins are 3.3 V and not 5 V ' +
        'tolerant — a 5 V line into one is a way to end the board — and the panel’s ' +
        'logic and backlight run happily at 3.3 V, so 3V3 is the only right rail here. ' +
        'Nothing in this exercise needs 5 V, and the one wire that could supply it is ' +
        'the one that kills a Pi.',
      'Decide what the panel’s four lines actually are, because only three of them are ' +
        'SPI. CLK and DIN come out of the hardware peripheral and cannot be moved; D/C ' +
        'is an ordinary GPIO the program drives by hand, exactly as the Uno’s D9 was in ' +
        'Module 3. Treat it as a peripheral line and the program loses its only way to ' +
        'say “command” rather than “colour”, and every pixel byte is read as an opcode.',
      'Decide that the panel is chosen by a wire, not an address. SPI has no ' +
        'addressing: the device that responds is the one whose chip-select is asserted, ' +
        'which is why CS is a pin of its own. Share it with a second device, or park it ' +
        'on a pin nobody asserts, and the bytes go onto the bus unclaimed — the window ' +
        'is never opened and the panel does nothing while the program reports success.',
      'Decide the button the way gpiozero wants it: one leg to a GPIO, one to ground, ' +
        'nothing between. Constructing a Button turns that pin’s pull-up on, so the ' +
        'line idles high and a press grounds it — the same no-resistor reasoning as ' +
        'Module 1, restated because the object doing the pulling is new.',
      'Decide what a frame costs before writing the next one. 320 × 240 × 2 bytes is ' +
        '153,600 bytes, about 150 ms on an 8 MHz bus — which is why every button press, ' +
        'a full redraw, is a whole picture’s worth of time, and why the address window ' +
        'is the thing that makes anything faster possible.',
    ],
    wiring: [
      {
        pin: 'GPIO11',
        terminal: 'CLK',
        why:
          'SPI0’s clock is fixed here; there is no second pin to move it to. On any other ' +
          'pin the panel is powered and being sent data it has no way to time — the screen ' +
          'stays black while the serial monitor keeps printing waypoints, which points at ' +
          'the program and never at the one wire that is wrong.',
      },
      {
        pin: 'GPIO10',
        terminal: 'DIN',
        why:
          'This is SPI0’s data line, the fixed other half of the clock. The window ' +
          'commands are a handful of bytes and would survive some noise, but every colour ' +
          'after them is data on this line: moved to the wrong pin, the map is a smear or ' +
          'nothing at all, and no byte anywhere looks like an error.',
      },
      {
        pin: 'GPIO8',
        terminal: 'CS',
        why:
          'The one panel wire that chooses rather than describes. It is deliberately a ' +
          'pin of its own: two devices sharing a select are one byte stream with two ' +
          'readers, each drawing something different from the same bytes. Loose, it is ' +
          'the classic frozen screen — the panel holds its last frame and never checks ' +
          'whether anyone is still talking.',
      },
      {
        pin: 'GPIO24',
        terminal: 'D/C',
        why:
          'Data/command must be an ordinary GPIO the program drives by hand, which is ' +
          'why it is not one of the three SPI lines. It is the panel’s only way to tell ' +
          '0x2A, a window command, from a colour byte. Tie it to the wrong level and every ' +
          'colour is read as an opcode — an opcode the panel does not know is discarded ' +
          'in silence, so the panel goes dark and nothing complains.',
      },
      {
        pin: '3V3',
        terminal: 'VCC',
        why:
          'The panel’s logic and backlight run at 3.3 V, and 3.3 V is what the Pi’s pins ' +
          'are. The failure mode here is not a dead screen but a dead Pi: 5 V into a GPIO ' +
          'pin ends the board rather than making the display brighter, and no warning ' +
          'arrives before the damage does.',
      },
      {
        pin: 'GND',
        terminal: 'GND',
        why:
          'SPI is two voltages compared against a shared reference, and without the ' +
          'ground there is no reference. The level on DIN floats and the bits are ' +
          'whatever the wire couples — plausible one moment and a smear the next, which ' +
          'reads as a software bug and never as the missing ground it is.',
      },
      {
        pin: 'GPIO4',
        terminal: 'a',
        why:
          'The button’s readable leg. gpiozero polls this line and treats a grounded ' +
          'press as the whole event; on a pin the program never reads, the key is simply ' +
          'ignored — the marker never moves and the button looks worn out rather than ' +
          'misplaced.',
      },
      {
        pin: 'GND',
        terminal: 'b',
        why:
          'The press itself: the pull-up holds the line high, and joining it to ground ' +
          'pulls it down. Left floating, the pin reads noise — the marker walks its ' +
          'waypoints on its own, or the button seems to work only when you are touching ' +
          'the wrong thing.',
      },
    ],
    working: [
      'Press Run and the panel lights first, then the map arrives a moment later. That ' +
        'gap is not the bench being slow: it is 153,600 bytes crossing the bus, which is ' +
        'a full frame’s worth of time even at 8 MHz.',
      'The serial monitor prints `waypoint 0 at 24,200` — the marker sits on the first ' +
        'waypoint, named in panel pixels. Those coordinates exist nowhere but in the ' +
        'program: nothing here opened an image, and every pixel of that map is two bytes ' +
        'this sketch decided to send.',
      'Press the button and the monitor prints `waypoint 1 at 70,140`, and the whole map ' +
        'is redrawn to move one small marker. Keep pressing and it wraps back to the ' +
        'start. Each press costing a full frame is the exercise’s real subject: the cost ' +
        'of a frame is what decides how real display programs draw.',
      'Now the experiment worth doing: shrink the sea fill to a corner and run it again. ' +
        'The rest of the glass keeps whatever it held — the program no longer writes ' +
        'those pixels, and nothing on the panel ever goes back to being blank on its ' +
        'own. Knowing what your last frame actually covered is the only cure.',
    ],
    traps: [
      'Moving the D/C wire onto ground, as the fault does. Every byte is now read as a ' +
        'command, and an opcode the panel does not know is discarded without a word — so ' +
        'it goes dark and nothing anywhere reports. The Bus Monitor shows the bytes going ' +
        'out unchanged, which is the point: the wire, not the bytes, is what broke.',
      'A loose or mispinned CS. The panel keeps its last picture and never checks ' +
        'whether it is still being spoken to, so “the screen froze” and “the wire came ' +
        'loose” are the same picture. This is the fault that sends people into the code ' +
        'for an hour when the answer is one jumper.',
      'Reading the button as a bare pin instead of building a Button. Nothing turns the ' +
        'pull-up on, the line floats, and the pin reports presses nobody made — the ' +
        'marker drifting on its own looks like a ghost in the program rather than a ' +
        'missing resistor.',
      'A wrong window or wrongly packed RGB565. A window that names the wrong rectangle ' +
        'still fills it, so a single wrong byte shifts everything after it rather than ' +
        'failing cleanly — the result reads as a damaged display, and the place to look ' +
        'is 0x2A and 0x2B.',
    ],
  },
  sketch: SKETCH,
  fault: {
    break_:
      'Move the D/C wire from GPIO24 onto the ground rail, so the panel sees every byte as ' +
      'a command, and run the sketch again.',
    teaches:
      'The panel goes dark and nothing complains. Every colour is now being read as an ' +
      'opcode, and an opcode it does not know is discarded without a word — which is ' +
      'exactly what the real controller does, and why a display protocol is a protocol ' +
      'rather than a conversation. The Bus Monitor shows the bytes going out unchanged, ' +
      'which is the point: the wire between them, not the bytes, is what broke.',
  },
  hints: [
    {
      when: 'The screen stays black and the serial monitor is printing waypoints.',
      answer:
        'The program is running, so the fault is electrical or the chip-select. Check that ' +
        'CS is on GPIO8 and that GPIO8 is actually driven — the sketch only touches CS when ' +
        'it starts a window, so a select wire that is not connected leaves every window ' +
        'unserved.',
    },
    {
      when: 'The panel lights but the map is a smear or one band of the wrong colour.',
      answer:
        'The window is wrong, or RGB565 is being packed in the wrong order. A window that ' +
        'names the wrong rectangle still fills it, so a single wrong byte shifts everything ' +
        'after it rather than failing cleanly — check 0x2A and 0x2B first.',
    },
    {
      when: 'The button seems to do nothing, or it reacts on its own.',
      answer:
        'The pin is not pulled up. gpiozero asks for a pull-up when it builds a Button, and ' +
        'the button grounds the line when pressed — so the pull-up is what makes the idle ' +
        'state readable at all. If you replaced Button with a bare read of the pin, it will ' +
        'float and report presses nobody made.',
    },
    {
      when: 'It is unbearably slow and you are wondering whether the Pi is at fault.',
      answer:
        'No. A full frame is 320 × 240 pixels × 2 bytes = 153,600 bytes, and at the 8 MHz ' +
        'the bench models that is about 150 ms — on every SPI display, on every Pi. The bench ' +
        'runs slower than the hardware because it executes your program step by step, but ' +
        'the byte count and the bus time are the real ones. Real programs redraw only what ' +
        'changed, which is exactly what the address window is for.',
    },
  ],
  references: [
    {
      term: 'SPI',
      what:
        'A bus with no addresses. A device is chosen by a chip-select line and told nothing ' +
        'about who it is, so two devices sharing a select are not two devices — the bytes ' +
        'arrive at both and each reads them differently.',
      readMore: 'The Module 3 exercise on two panels is the same lesson with two of them.',
    },
    {
      term: 'Address window',
      what:
        'The rectangle the controller writes into next. Every pixel byte lands in the ' +
        'window and then the cursor steps on, wrapping at the edge. It is why a display can ' +
        'be faster than a full redraw.',
    },
    {
      term: 'RGB565',
      what:
        'Sixteen bits per pixel, five for red, six for green, five for blue. The extra bit ' +
        'goes to green because the eye resolves it best.',
    },
    {
      term: 'BCM numbering',
      what:
        'The Pi names its pins by what they are attached to inside the chip, not by where ' +
        'they sit. GPIO17 is physical pin 11, and a program that says "pin 11" is talking ' +
        'about something else entirely. An Uno’s silkscreen and its firmware numbers agree; ' +
        'a Pi’s deliberately do not.',
    },
    {
      term: 'pull-up',
      what:
        'A resistor to the supply, weak enough to be overridden by a transistor. It gives an ' +
        'input a defined idle level, which is what lets a button with one leg to ground and ' +
        'one to a pin work with nothing else on the node.',
    },
    {
      term: 'gpiozero',
      what:
        'The Python library a Pi uses for pins. Objects rather than functions: you build a ' +
        'LED on a pin and then turn it on, which reads as the hardware does rather than as a ' +
        'sequence of mode changes.',
      readMore: 'gpiozero.readthedocs.io',
    },
  ],
  writeUp: 'docs/exercises/module-5-single-board-computers.md',
  setup: (simulation) => {
    simulation.clearExampleParts();
    const ground = simulation.boardTerminal('GND');
    const supply = simulation.boardTerminal('3V3');
    const clock = simulation.boardTerminal('GPIO11');
    const data = simulation.boardTerminal('GPIO10');
    const select = simulation.boardTerminal('GPIO8');
    const dataCommand = simulation.boardTerminal('GPIO24');
    const move = simulation.boardTerminal('GPIO4');
    if (!ground || !supply || !clock || !data || !select || !dataCommand || !move) return;

    const display = simulation.addPart(part('2.4" TFT (ILI9341)'), PART_X, PART_Y);
    const sck = simulation.pinAt(display, 'SCK');
    const mosi = simulation.pinAt(display, 'MOSI');
    const cs = simulation.pinAt(display, 'CS');
    const dc = simulation.pinAt(display, 'DC');
    const vcc = simulation.pinAt(display, 'VCC');
    const gnd = simulation.pinAt(display, 'GND');
    if (!sck || !mosi || !cs || !dc || !vcc || !gnd) return;

    simulation.routeWire(clock, sck);
    simulation.routeWire(data, mosi);
    simulation.routeWire(dataCommand, dc);
    simulation.routeWire(select, cs);
    simulation.routeWire(supply, vcc);
    simulation.routeWire(ground, gnd);

    /*
     * The button's second leg goes to ground and nothing else does. There is no
     * resistor here for the same reason there is none in Module 1: gpiozero
     * turns the pin's pull-up on when the Button is constructed, and a button on
     * a pulled-up line reads high until something grounds it.
     */
    const button = simulation.addPart(part('Tactile Button'), PART_X, PART_Y + PART_STEP);
    const buttonA = simulation.pinAt(button, 'a');
    const buttonB = simulation.pinAt(button, 'b');
    if (!buttonA || !buttonB) return;

    simulation.routeWire(move, buttonA);
    simulation.routeWire(buttonB, ground);
  },
};

export const MODULE_5_SBC: readonly Exercise[] = [POCKET_MAP];