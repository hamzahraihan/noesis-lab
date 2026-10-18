/**
 * Module 5 — Maps on a screen.
 *
 * The first lesson to reach outside the board for its data. Everything before
 * this drew what the program could work out for itself; a map is the other
 * kind of thing, and it changes the shape of the code -- because a picture
 * arrives eventually rather than instantly, and a program that has to wait for
 * one is a different program from one that never does.
 */

import { CIRCUITS } from '../circuits';
import type { Exercise } from '../exercises';

/**
 * Somewhere worth looking at.
 *
 * Latitude and longitude are the coordinates every map agrees on, and this is
 * the middle of Green Park. The numbers are what the sketch turns into a tile
 * address, so change them and the whole map moves.
 */
const LATITUDE = 51.5067;
const LONGITUDE = -0.1427;

/**
 * Zoom, in the scale every slippy map uses.
 *
 * At zoom `z` the world is cut into `2^z` squares a side, so each step in is a
 * doubling: 12 is a continent, 16 is a city, 19 is a street. Each tile is 256
 * pixels, so at 16 a tile covers about 380 m across at this latitude.
 */
const ZOOM = 16;

const SKETCH = `/*
 * A pocket map on an ESP32 and a 3.2" TFT, drawn from OpenStreetMap tiles.
 *
 * The board has no map in it and no way to draw one on its own. What it has is
 * a way to ask for a picture and a way to show one, and everything below is
 * about the loop that sits between the two.
 */
#include <Arduino.h>

#define TFT_CS   5
#define TFT_DC   15
#define TFT_MOSI 23
#define TFT_SCK  18

#define BTN_WEST   4
#define BTN_EAST  13
#define BTN_ROTATE 27

/* The sine and log below both need it, and the VM does not define it. */
#define PI 3.14159265358979

#define WIDTH   480
#define HEIGHT  320
#define TILE    256

/* RGB565, which is what the panel stores. The panel takes one 16-bit value. */
#define BLACK  0x0000
#define WHITE  0xFFFF

/* Somewhere to look. Any latitude and longitude will do. */
#define LATITUDE   51.5067
#define LONGITUDE  -0.1427
#define ZOOM       16

/*
 * The tile the middle of the screen sits on.
 *
 * Everything the map is goes wrong when these are wrong and nowhere else, so
 * they are the first thing to look at when the screen is black.
 */
int centreX = 0;
int centreY = 0;

bool fetching = false;

/*
 * How far the view reaches either side of the middle.
 *
 * Worked out from the screen rather than written down, because the screen is
 * not a constant any more: turning the panel swaps 480 and 320, and a sketch
 * that had hardcoded the count would quietly show a third of the map sideways.
 */
int reachX = 1;
int reachY = 1;

/*
 * A latitude and a longitude, on the tile they land on.
 *
 * This is Mercator, and it is why a slippy map is square. The world is a
 * sphere; a square sheet of paper is not; so the sphere has to be stretched to
 * fit one, and this is the stretch. The sin() is the stretch. Nothing else on
 * the screen is this hard, and that is because nothing else on the screen is
 * asking where on the Earth it is.
 *
 * The clamp on the latitude is the edge of the map: at the poles the
 * projection is infinite, so the tiles simply stop and a program that does not
 * notice will ask for one that does not exist.
 */
int tileX(double lon, int z) {
  int n = 1 << z;
  int x = floor((lon + 180.0) / 360.0 * n);
  if (x < 0) x = 0;
  if (x > n - 1) x = n - 1;
  return x;
}

int tileY(double lat, int z) {
  int n = 1 << z;
  double rad = lat * PI / 180.0;
  double s = sin(rad);
  int y = floor((0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * PI)) * n);
  if (y < 0) y = 0;
  if (y > n - 1) y = n - 1;
  return y;
}

/*
 * Ask for every tile the screen needs.
 *
 * Three across and three down would cover a 480x320 panel; the half-tile
 * margin the division adds asks for five by three -- nine on the 2.4" and
 * fifteen here. Asking for more than you need is cheap the first time and
 * free afterwards, because the tiles are already in the cache.
 */
void requestArea() {
  for (int dy = -reachY; dy <= reachY; dy++) {
    for (int dx = -reachX; dx <= reachX; dx++) {
      map.request(ZOOM, centreX + dx, centreY + dy);
    }
  }
}

/*
 * Draw every tile that has arrived, and say where they came from.
 *
 * A tile that has not turned up is skipped rather than waited for, so the
 * screen fills in from the middle outwards instead of appearing all at once at
 * the end. On a real board that is the difference between a map and a blank
 * screen with a spinner.
 *
 * The offset puts the middle tile under the middle of the glass, so panning by
 * one tile at a time moves the picture by one whole picture rather than
 * jumping.
 *
 * The credit line is not decoration. The OpenStreetMap tile servers are run by
 * volunteers and their policy asks any client to say where its data came from,
 * so a program that fetches their tiles and displays them owes them a line on
 * the screen -- and the text is measured rather than guessed at, so it stays in
 * one piece whichever way the panel is turned.
 */
void drawArea() {
  for (int dy = -reachY; dy <= reachY; dy++) {
    for (int dx = -reachX; dx <= reachX; dx++) {
      map.blit(ZOOM, centreX + dx, centreY + dy,
               dx * TILE + (WIDTH - TILE) / 2,
               dy * TILE + (HEIGHT - TILE) / 2);
    }
  }

  /* A strip behind the text, so it stays legible over a dark tile. */
  int lineHeight = tft.textHeight() + 4;
  tft.fillRect(0, tft.height() - lineHeight, tft.width(), lineHeight, BLACK);

  tft.print("(C) OpenStreetMap contributors", 2, tft.height() - lineHeight + 2, WHITE);
}

/*
 * The button, held down.
 *
 * Active low, so the pin is pulled up and a press grounds it -- the same
 * arrangement as every other button in this curriculum, and the reason none of
 * them needs a resistor.
 */
bool held(int pin) {
  return digitalRead(pin) == LOW;
}

/*
 * Turn the panel and find out how big it now is.
 *
 * This is the one call on a TFT that has no equivalent on the SPI bus it is
 * driven by: MADCTL tells the chip how to walk its own memory, so the same
 * glass is 480x320 one way up and 320x480 the other. It is why a real library
 * makes you ask rather than tell you -- and why the code below uses the answer
 * instead of the numbers at the top of the sketch.
 */
int applyRotation(int rotation) {
  tft.setRotation(rotation);
  return rotation;
}

void setup() {
  Serial.begin(115200);

  pinMode(TFT_CS, OUTPUT);
  pinMode(TFT_DC, OUTPUT);
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(TFT_DC, LOW);

  SPI.begin();
  SPI.beginTransaction();
  SPI.transfer(0x11, 0);   // sleep out of power-save
  SPI.transfer(0x29, 0);   // display on
  SPI.end();

  /* Sideways, which is how a map wants to be read. */
  applyRotation(1);

  /*
   * How many tiles the panel needs, each way.
   *
   * The division has to be an integer one, and that is not a detail: 480+128
   * over 256 is 2.375, and a reach of 2.375 walks the loop to 2.375, so the
   * requests go out as tiles 32739.625 and 21789.625 -- addresses that do not
   * exist. Nothing comes back, map.ready() never turns true, and the panel
   * stays black while the serial monitor cheerfully reports the centre tile.
   * A wrong tile number looks exactly like a dead network from here.
   */
  reachX = idiv(tft.width() + TILE / 2, TILE);
  reachY = idiv(tft.height() + TILE / 2, TILE);

  pinMode(BTN_WEST, INPUT_PULLUP);
  pinMode(BTN_EAST, INPUT_PULLUP);
  pinMode(BTN_ROTATE, INPUT_PULLUP);

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
  /*
   * The wait.
   *
   * map.request() starts a fetch and says whether the tile is already here.
   * Until every tile has arrived there is nothing to draw, so the loop does
   * the only honest thing available and waits. This loop is the difference
   * between a map program and a drawing program, and it is not optional: a
   * picture over a network is never there at the moment you ask for it.
   */
  if (!map.ready()) {
    delay(20);
    return;
  }

  if (fetching) {
    drawArea();
    fetching = false;
    Serial.println("map drawn");
  }

  /* One tile east or west of here, if a button is down. */
  if (held(BTN_WEST) || held(BTN_EAST)) {
    delay(250);                       // a press, not a hold
    centreX = centreX + (held(BTN_EAST) ? 1 : -1);
    requestArea();
    fetching = true;
    Serial.print("moved to tile ");
    Serial.println(centreX);
  }

  /*
   * Turn the panel a quarter turn.
   *
   * The reach has to be worked out again afterwards, because the screen is now
   * the other way round and the same tile covers a different part of it. Get
   * that order wrong and the map comes back drawn for the wrong panel -- which
   * is the bug this line exists to head off, not to demonstrate.
   */
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
`;

const OSM_MAP: Exercise = {
  id: '5.1',
  title: 'A map on a TFT, from OpenStreetMap',
  level: 5,
  module: 'Module 5 — Maps on a Screen',
  board: 'esp32',
  difficulty: 'Intermediate',
  minutes: '60–75 mins',
  brief:
    'Draw real map tiles from OpenStreetMap onto a 3.2" TFT over an ESP32, walk ' +
    'east and west across them, and turn the panel on its side. The tiles are ' +
    'fetched from the OpenStreetMap servers — the pictures are not in the board ' +
    'and not in the sketch. What is in the sketch is the arithmetic that turns ' +
    'a latitude and a longitude into a tile address, the loop that waits for a ' +
    'picture it asked for to arrive, and the one call that changes how big the ' +
    'screen is.',
  concepts: [
    'What a slippy map actually is: a grid of squares, addressed by three numbers',
    'Mercator projection, and why the world looks the wrong shape on a flat map',
    'Asynchronous fetching: asking for something that is not there yet',
    'Blitting a finished picture, rather than pushing it a byte at a time',
    'Rotation: MADCTL, and why the screen changes size when the panel turns',
    'Caching, and why asking for a tile twice costs nothing the second time',
    'Active-low inputs and the pull-up that makes a button readable',
  ],
  parts: [
    { name: '3.2" TFT (ILI9341)', qty: 1, why: '480×320 pixels, which is where the map goes.' },
    { name: 'Tactile Button', qty: 3, why: 'East, west, and turning the panel on its side.' },
  ],
  wiring: [
    { pin: 'GPIO23', part: '3.2" TFT (ILI9341)', terminal: 'DIN', goesTo: "SPI1's data line" },
    { pin: 'GPIO18', part: '3.2" TFT (ILI9341)', terminal: 'CLK', goesTo: "SPI1's clock" },
    {
      pin: 'GPIO5',
      part: '3.2" TFT (ILI9341)',
      terminal: 'CS',
      goesTo: 'chip-select — the hardware SS pin',
    },
    {
      pin: 'GPIO15',
      part: '3.2" TFT (ILI9341)',
      terminal: 'D/C',
      goesTo: 'data/command, an ordinary GPIO',
    },
    { pin: '3V3', part: '3.2" TFT (ILI9341)', terminal: 'VCC', goesTo: 'the 3.3 V rail' },
    { pin: 'GND', part: '3.2" TFT (ILI9341)', terminal: 'GND', goesTo: 'ground' },
    { pin: 'GPIO4', part: 'Tactile Button', terminal: 'a', goesTo: 'west' },
    { pin: 'GND', part: 'Tactile Button', terminal: 'b', goesTo: 'ground' },
    { pin: 'GPIO13', part: 'Tactile Button', terminal: 'a', goesTo: 'east' },
    { pin: 'GND', part: 'Tactile Button', terminal: 'b', goesTo: 'ground' },
    { pin: 'GPIO27', part: 'Tactile Button', terminal: 'a', goesTo: 'turn the panel' },
    { pin: 'GND', part: 'Tactile Button', terminal: 'b', goesTo: 'ground' },
  ],
  steps: [
    'Wire the panel to SPI1: D23 for data, D18 for the clock, D5 for the chip-select, ' +
      'and D15 for the data/command line. Note that three of those four come out of ' +
      'the peripheral and the fourth does not — D15 is an ordinary pin the sketch ' +
      'drives, exactly as the Uno’s D9 was in Module 3.',

    'Power the panel from 3V3 and give it ground. The ESP32’s pins are 3.3 V and are ' +
      'not 5 V tolerant, which is the one number worth memorising about this board.',

    'Three buttons, each one leg to a pin and one to ground. No resistors: the sketch ' +
      'turns the pull-ups on with INPUT_PULLUP. West and east pan the map; the third ' +
      'turns the panel a quarter turn.',

    'Press Run. The serial monitor prints the tile the screen is centred on, then ' +
      '"map drawn", and the panel shows real streets. It takes a moment the first ' +
      'time because the tiles are being fetched from the internet, and it is instant ' +
      'every time after that.',

    'Press a button. The map moves one tile east or west and the serial monitor names ' +
      'the new tile. Watch the Bus Monitor stay empty: a tile that is already cached ' +
      'costs nothing, and asking for the same one twice is not a second download.',

    'Now the experiment. Change ZOOM from 16 to 18. The same latitude and longitude now ' +
      'sit on a much smaller tile, and the map zooms in by two steps — which is what ' +
      'doubling means. Change it to 14 and it zooms out. Nothing else about the program ' +
      'changes, because the zoom is a number the arithmetic takes rather than a thing ' +
      'the code knows.',

    'Then change LONGITUDE to -0.1276 and LATITUDE to 51.5072. The screen jumps. ' +
      'Everything between here and there was one number in the sketch, and that is ' +
      'what coordinates are for.',

    'Press the third button. The panel turns a quarter turn and the serial monitor names ' +
      'the new screen size — 320×480 rather than 480×320 — and the map draws again in the ' +
      'new shape. The same tiles now cover a different part of the glass, which is why the ' +
      'sketch works out how many it needs from the panel rather than writing the number ' +
      'down: a number written down is right for exactly one orientation.',

    'Finally, take the D5 chip-select wire off and run it. The map stays on the ' +
      'screen. A panel holds the last picture it was given and does not check whether ' +
      'it is still being spoken to — so "the screen froze" and "the wire came loose" ' +
      'look exactly the same from in here, which is why you check the wires first.',
  ],
  solution: {
    approach: [
      'Decide what the program is really naming. The board holds no picture and cannot ' +
        'draw one, so the sketch never describes streets — it names squares. A tile is ' +
        'addressed by three numbers (zoom, x, y) and everything else in the exercise is ' +
        'bookkeeping about which of those squares the glass is showing.',
      'Decide that the coordinates have to be turned into a tile address before anything ' +
        'else can happen, and that longitude and latitude are not the same arithmetic. ' +
        'Longitude is a plain fraction of the way round the world, which is why `tileX()` ' +
        'is a divide. Latitude has to be stretched first — that is the `sin()` and the ' +
        '`log()` in `tileY()`, and it is the whole of the Mercator projection. Leave the ' +
        'stretch out and the numbers are still plausible, so the map simply lands in the ' +
        'wrong place.',
      'Decide that the screen size is an answer, not a constant. Rotating the panel swaps ' +
        '480 for 320, so the number of tiles to ask for has to be worked out from ' +
        '`tft.width()` and `tft.height()` rather than written down — and with `idiv()`, ' +
        'because a reach of 2.375 walks the request loop to 2.375 and asks for tiles ' +
        '32739.625 and 21789.625, which do not exist.',
      'Decide that panning moves the centre tile, not the pixels. A press nudges ' +
        '`centreX` by one and re-requests, and `drawArea()` works out the offset that puts ' +
        'the centre tile under the centre of the glass — so the picture moves by one ' +
        'whole picture rather than jumping by a hand-computed number of pixels.',
      'Decide that the loop has to be allowed to say "not yet". A tile requested over the ' +
        'network is never there at the moment you ask, so `loop()` returns early until ' +
        '`map.ready()` is true. That single early return is the difference between a map ' +
        'program and a drawing program, and it is also why the buttons cannot be read ' +
        'until the pictures arrive.',
    ],
    wiring: [
      {
        pin: 'GPIO23',
        terminal: 'DIN',
        why:
          'MOSI is fixed on the ESP32’s SPI1 — there is no second pin it can be moved to. ' +
          'Anywhere else and the panel is never told what colour anything is: the screen ' +
          'stays black while the serial monitor still prints a tile number, which reads as ' +
          'a dead panel rather than a wire in the wrong hole.',
      },
      {
        pin: 'GPIO18',
        terminal: 'CLK',
        why:
          'The clock says which bits on the data line are valid. VSPI’s clock is fixed on ' +
          '18, so a wire on any other pin leaves the panel being sent data it has no way ' +
          'to time — a black screen that looks exactly like the MOSI wire being loose.',
      },
      {
        pin: 'GPIO5',
        terminal: 'CS',
        why:
          'Chip-select is the one the ESP32 drives for you as the hardware SS, which is why ' +
          '`setup()` pulls it HIGH by hand. Change `TFT_CS` in the sketch without moving ' +
          'this wire and the panel is listening to a bus nobody is speaking on; leave it ' +
          'unpulled and the display never leaves its reset state.',
      },
      {
        pin: 'GPIO15',
        terminal: 'D/C',
        why:
          'Data/command is how the panel tells a command byte from a pixel byte, and it is ' +
          'an ordinary GPIO the sketch drives — not a peripheral line. Tie it to the wrong ' +
          'level and every byte in the blit is read as a command instead of a colour, so ' +
          'the screen lights and never draws.',
      },
      {
        pin: '3V3',
        terminal: 'VCC',
        why:
          'The panel’s logic and backlight are 3.3 V, and the ESP32’s pins are 3.3 V and ' +
          'not 5 V tolerant. Put it on the 5 V rail and the symptom is a panel that lights ' +
          'and then stops answering mid-fetch, which is very hard to tell from a flaky ' +
          'network.',
      },
      {
        pin: 'GND',
        terminal: 'GND',
        why:
          'SPI needs a shared reference between the two devices. Without it the level ' +
          'shifters on the module float and the panel may or may not latch each bit; the ' +
          'sketch still reports a tile and blits a picture into a display that shows ' +
          'nothing, which points at the code and never at the missing ground.',
      },
      {
        pin: 'GPIO4',
        terminal: 'a',
        why:
          'West is nothing more than a decrement of `centreX`, and it is polled by ' +
          '`held()`. Wire it to a pin the sketch never reads and the key is silently ' +
          'ignored — the map stops responding on that side and the button looks worn ' +
          'out rather than misplaced.',
      },
      {
        pin: 'GND',
        terminal: 'b',
        why:
          'The other leg is the press itself: `INPUT_PULLUP` holds the pin HIGH until a ' +
          'press joins the two. Left floating, the west pin reads whatever noise is on it, ' +
          'so the map either creeps west on its own or never responds to the key at all.',
      },
      {
        pin: 'GPIO13',
        terminal: 'a',
        why:
          'East and west are the same line of code with a different sign, so a misrouted ' +
          'east key gives a map that moves one way only. Nothing reports the mistake — the ' +
          'button simply behaves as though it were never pressed.',
      },
      {
        pin: 'GND',
        terminal: 'b',
        why:
          'Without ground on this leg the east pin floats in the same way the west one ' +
          'would, and the two keys fail together — which is the clue that the problem is ' +
          'the shared ground rather than either button.',
      },
      {
        pin: 'GPIO27',
        terminal: 'a',
        why:
          'This is the one button deliberately kept off a strapping pin. GPIO0, 2, 12 and ' +
          '15 all come up in a special state at reset, and a key that grounds one of those ' +
          'can be read as held at boot — the panel rotating itself before anyone has ' +
          'touched anything.',
      },
      {
        pin: 'GND',
        terminal: 'b',
        why:
          'The rotate key is the one that proves the ground works, because its press is ' +
          'the only button whose effect is visible in a single step. If it does nothing ' +
          'while the other two work, the fault is this wire rather than the sketch.',
      },
    ],
    working: [
      'At 115200 the serial monitor prints `centred on tile 32742,21792` and then, a moment ' +
        'later, `map drawn`. The first line is the arithmetic naming a real tile — that ' +
        'address is a square of land in Green Park — and the second is `map.ready()` ' +
        'turning true and the blit having run.',
      'The panel shows real streets rather than a blank rectangle, and they fill in from ' +
        'the middle outwards rather than appearing all at once. That order is the double ' +
        'loop in `requestArea()` asking for the centre tile first, and it is the proof that ' +
        '`drawArea()` skips what has not arrived instead of waiting for all of it.',
      'A button press prints `moved to tile 32743` and the picture shifts by one whole ' +
        'map. The Bus Monitor stays empty at the same time, which is the cache: asking for ' +
        'a tile the board already has costs nothing and is not a second download.',
      'The rotate key prints `rotated to 320x480`, the panel clears, and the same streets ' +
        'come back re-fitted to the taller shape. That it redraws at all is the proof the ' +
        'reach was recomputed after the turn — a map drawn for the old panel comes back ' +
        'with a band of undrawn glass down one side.',
    ],
    traps: [
      'Reaching with floating division instead of `idiv()`. The serial monitor still ' +
        'prints a perfectly valid centre tile — it is computed correctly, only the reach is ' +
        'wrong — and then nothing ever comes back, so the panel is black forever. There is ' +
        'no error anywhere to read, and a tile address that does not exist looks exactly ' +
        'like a slow network from inside the sketch.',
      'Rotating without reworking the reach. The map comes back drawn for the panel in its ' +
        'old orientation, with undrawn glass down one side and the picture sitting ' +
        'off-centre. It reads as the display having lost part of itself, or as a tile that ' +
        'came back the wrong size.',
      'Not clamping the latitude, as the fault does. The screen goes blank and the serial ' +
        'monitor stops naming a tile at all — not because the network died but because the ' +
        'program is waiting on a tile the projection says exists and the server says does ' +
        'not. It fails by never finishing, which beginners read as broken hardware.',
      'Pulling the chip-select or data/command wire loose once the map is up. A panel holds ' +
        'the last picture it was given and never checks whether it is still being spoken ' +
        'to, so "the screen froze" and "the wire came loose" are the same picture. Check the ' +
        'wires before you go looking in the code.',
    ],
  },
  sketch: SKETCH,
  fault: {
    break_:
      'Change the clamp on latitude in tileY() from 85.05 to 360, so the program asks for ' +
      'tiles at the very top of the projection, and run it.',
    teaches:
      'The map goes blank and the serial monitor stops reporting a tile at all. Those ' +
      'clamp lines are not tidiness — at the poles the projection is infinite, and a ' +
      'program that does not clamp asks for a tile that does not exist and waits for ' +
      'it forever. The map does not fail loudly because there is no error to report; ' +
      'it fails by never finishing, which is the harder kind of bug to find.',
  },
  hints: [
    {
      when: 'The serial monitor prints a tile number and then nothing at all.',
      answer:
        'It is waiting for tiles that have not arrived. Check the network: the tiles come ' +
        'from tile.openstreetmap.org, so a machine without internet will sit in exactly ' +
        'this state, and there is nothing on the screen to say so.',
    },
    {
      when: 'The screen is lit but completely black.',
      answer:
        'The panel was told to light but no tile was blitted. Compare the tile number ' +
        'the sketch prints against tile.openstreetmap.org/16/x/y.png in a browser — if ' +
        'that image has streets in it and your screen does not, the tiles arrived and ' +
        'the blit did not, which points at the select line.',
    },
    {
      when: 'The map is there but in the wrong place.',
      answer:
        'The arithmetic, not the fetch. Print centreX and centreY and look them up on ' +
        'the OSM site for the same zoom. A latitude and longitude swapped over is the ' +
        'commonest version, and it puts you somewhere in the sea.',
    },
    {
      when: 'It works but each pan takes several seconds.',
      answer:
        'Every tile is being fetched again, which means the cache is not holding. Check ' +
        'that the numbers reaching request() are the same each time — a value drifting ' +
        'by one because of a rounding difference is a cache miss on every single ' +
        'request.',
    },
  ],
  references: [
    {
      term: 'Slippy map',
      what:
        'The tile scheme every web map uses: the world in square powers of two, at a ' +
        'zoom you choose. Tile 16/32742/21792 is a square about 380 m across in London.',
      readMore: 'wiki.openstreetmap.org/wiki/Slippy_map_tilenames',
    },
    {
      term: 'Mercator projection',
      what:
        'The stretch that makes a sphere fit on a square sheet of paper. It is why ' +
        'Greenland looks the size of Africa, and why nothing near either pole is any ' +
        'use on a flat map. It is the sin() and the log() in tileY().',
    },
    {
      term: 'Tile server policy',
      what:
        'The public OpenStreetMap tile server is donated by volunteers. Clients must ' +
        'identify themselves, must not hammer it, and must show ' +
        '"© OpenStreetMap contributors" on anything they draw. A lesson asking for a ' +
        'handful of tiles is the kind of client that policy is written for.',
      readMore: 'operations.osmfoundation.org/policies/tiles',
    },
    {
      term: 'Blit',
      what:
        'Copying a finished block of pixels to the screen in one go, rather than pushing ' +
        'it a byte at a time. The streaming commands can only write what a program is ' +
        'calculating; a blit is how a display accepts a picture it was handed.',
    },
    {
      term: 'Attribution',
      what:
        'The credit line OpenStreetMap requires. Any screen showing its tiles should say ' +
        'where the data came from — that is the deal, not a formality.',
    },
  ],
  writeUp: 'docs/exercises/module-5-maps.md',
  circuit: CIRCUITS['5.1'],
};

export const MODULE_5_MAPS: readonly Exercise[] = [OSM_MAP];

export { LATITUDE, LONGITUDE, ZOOM };
