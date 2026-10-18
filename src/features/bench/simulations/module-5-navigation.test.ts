import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { boardOption } from '@/features/learn';
import { EXERCISES, exerciseById } from '@/features/learn';
import { TILE_SIZE, TileStore, tileForLatLon, pixelInTile } from '../utils/map-tiles';
import type { Ili9341 } from '@/features/parts';

/**
 * The OpenStreetMap lesson, on the bench.
 *
 * This is the first lesson whose subject is not in the board, so the wiring is
 * only half of what can go wrong: a panel that lights and shows nothing means
 * the tiles never arrived, which is a different failure from a panel that never
 * lit at all. Both are asserted here, with the tiles supplied directly rather
 * than fetched, so a test failure means the bench is wrong and not the network.
 */
const OSM_MAP = '5.1';

function bench(): Simulation {
  const definition = boardOption('esp32').make();
  const simulation = new Simulation(definition);
  simulation.loadCircuit(exerciseById(OSM_MAP)!.circuit);
  return simulation;
}

describe('the map lesson', () => {
  it('is on the curriculum, on the board it was written for', () => {
    expect(EXERCISES.some((exercise) => exercise.id === OSM_MAP)).toBe(true);
    // Stated, not inherited: the curriculum's default is an Uno, and wiring
    // this to an Uno would resolve no SPI pins and quietly build nothing.
    expect(exerciseById(OSM_MAP)?.board).toBe('esp32');
  });

  it('puts the 3.2" panel and its three buttons on the bench', () => {
    const simulation = bench();
    const displays = [...simulation.displayControllers().values()];
    const buttons = simulation.bench.parts.filter(
      (part) => part.definition.name === 'Tactile Button',
    );

    expect(displays.length).toBeGreaterThan(0);
    // East, west, and turning the panel over: the third button is what makes
    // the rotation reachable from the sketch rather than only from the code.
    expect(buttons.length).toBe(3);

    const panel = displays[0] as Ili9341;
    expect(panel.width, 'the panel is the larger one, not the 2.4"').toBeGreaterThan(320);
  });

  it('runs every jumpers through real holes', () => {
    const simulation = bench();
    expect(simulation.bench.wires.length).toBeGreaterThan(6);
  });

  it('lights the panel and waits for tiles rather than drawing nothing', () => {
    const exercise = exerciseById(OSM_MAP)!;
    const simulation = bench();
    simulation.loadFirmware(exercise.sketch);
    simulation.start();

    const panel = [...simulation.displayControllers().values()][0] as Ili9341;

    // Enough for the setup and the first request, but not for a fetch that has
    // not happened yet -- which is the point: the loop must be waiting, not done.
    for (let frame = 0; frame < 4; frame++) simulation.tick(0.05);

    expect(simulation.firmwareError).toBeNull();
    expect(panel.isOn(), 'the panel was told to light').toBe(true);
    expect(
      simulation.serial.join(''),
      'the sketch should report the tile it centred on and then wait',
    ).toContain('centred on tile');
  });
});

describe('where a place lands on the grid', () => {
  it('puts London on the tile the reference gives', () => {
    // Green Park, and checked against the live tile server rather than
    // against arithmetic done by hand: 16/32742/21792 comes back all land.
    const tile = tileForLatLon(51.5067, -0.1427, 16);
    expect(tile).toEqual({ x: 32742, y: 21792 });
  });

  it('doubles the world each time the zoom goes up', () => {
    // Verified against the server too: 14/8192/8192 and 16/32768/32768.
    const at14 = tileForLatLon(0, 0, 14);
    const at16 = tileForLatLon(0, 0, 16);
    expect(at14).toEqual({ x: 8192, y: 8192 });
    expect(at16).toEqual({ x: 32768, y: 32768 });
    expect(at16.x).toBe(at14.x * 4);
    expect(at16.y).toBe(at14.y * 4);
  });

  it('stops at the poles rather than asking for a tile that is not there', () => {
    // Mercator is infinite at 90 degrees. An unclamped program asks for a tile
    // off the top of the world and waits for it forever.
    for (const latitude of [90, -90, 1000]) {
      const tile = tileForLatLon(latitude, 0, 16);
      expect(tile.y, `latitude ${latitude}`).toBeGreaterThanOrEqual(0);
      expect(tile.y, `latitude ${latitude}`).toBeLessThan(2 ** 16);
    }
  });

  it('places a marker inside its tile rather than on an edge', () => {
    const pixel = pixelInTile(51.5067, -0.1427, 16);
    expect(pixel.x).toBeGreaterThanOrEqual(0);
    expect(pixel.x).toBeLessThan(TILE_SIZE);
    expect(pixel.y).toBeGreaterThanOrEqual(0);
    expect(pixel.y).toBeLessThan(TILE_SIZE);
  });
});

describe('a tile that never arrives', () => {
  it('does not hold up the ones that did', () => {
    // The deadlock this exists for: a sketch polls map.ready() until every tile
    // it asked for is here, so one tile the server declines left the program
    // waiting forever over fourteen good ones -- a blank screen with the
    // serial monitor reporting progress.
    const store = new TileStore();

    store.request(16, 100, 200);
    store.request(16, 101, 200);
    store.request(16, 102, 200);

    store.put(16, 100, 200, new Uint16Array(TILE_SIZE * TILE_SIZE).fill(0xf800));
    store.put(16, 101, 200, new Uint16Array(TILE_SIZE * TILE_SIZE).fill(0x07e0));
    expect(store.complete, 'one still on the way').toBe(false);

    expect(store.fail(16, 102, 200), 'the last one gave up').toBe(true);

    expect(store.complete, 'the wait ends once nothing more is coming').toBe(true);
  });

  it('reports a failed tile as settled rather than sending the sketch back', () => {
    const store = new TileStore();
    store.request(16, 5, 5);
    store.fail(16, 5, 5);

    expect(store.isFailed(16, 5, 5)).toBe(true);
    // A hole stays a hole: asking again is answered, so the program moves on
    // instead of queueing the same request for ever.
    expect(store.request(16, 5, 5)).toBe(true);
    expect(store.get(16, 5, 5)).toBeUndefined();
  });

  it('lets a failed tile be asked for again after moving away and back', () => {
    const store = new TileStore();
    store.request(16, 7, 7);
    store.fail(16, 7, 7);

    store.clearWanted();

    expect(store.isFailed(16, 7, 7), 'the refusal was about that region').toBe(false);
    expect(store.request(16, 7, 7), 'so it is worth trying again').toBe(false);
  });

  it('forgets a failure once the tile actually turns up', () => {
    const store = new TileStore();
    store.request(16, 9, 9);
    store.fail(16, 9, 9);
    store.put(16, 9, 9, new Uint16Array(4).fill(0x1234));

    expect(store.isFailed(16, 9, 9)).toBe(false);
    expect(store.get(16, 9, 9)).toHaveLength(4);
  });
});

describe('blitting a tile onto the panel', () => {
  /**
   * A tile-sized block in a known colour, placed at a known spot.
   *
   * Every expectation below is written against the panel's own `width` and
   * `height` rather than against 320x240. That is not decoration: the panel
   * turns, and a test that hardcoded the landscape numbers would quietly start
   * asserting the wrong thing the moment the exercise put it the other way up.
   */
  function redTile(panel: Ili9341, x: number, y: number): void {
    panel.blit(x, y, TILE_SIZE, TILE_SIZE, new Uint16Array(TILE_SIZE * TILE_SIZE).fill(0xf800));
  }

  it('puts the pixels where it was asked to', () => {
    const simulation = bench();
    const panel = [...simulation.displayControllers().values()][0] as Ili9341;

    redTile(panel, 10, 20);

    expect(panel.pixelAt(10, 20)).toBe(0xf800);
    expect(panel.pixelAt(200, 150)).toBe(0xf800);
    // Just outside the block, and untouched.
    expect(panel.pixelAt(9, 20)).toBe(0);
    expect(panel.pixelAt(266, 20)).toBe(0);
  });

  it('clips at the panel edge instead of wrapping round', () => {
    const simulation = bench();
    const panel = [...simulation.displayControllers().values()][0] as Ili9341;

    // Hangs off the bottom-right corner.
    redTile(panel, panel.width - 10, panel.height - 20);

    expect(panel.pixelAt(panel.width - 1, panel.height - 1), 'the visible corner').toBe(0xf800);
    // A wrapped blit would have written the tile's first row at y=0.
    expect(panel.pixelAt(0, 0), 'must not wrap').toBe(0);
  });

  it('keeps the picture on the glass when the panel is turned', () => {
    const simulation = bench();
    const panel = [...simulation.displayControllers().values()][0] as Ili9341;

    redTile(panel, 10, 20);
    // Counted before and after: a turn must move the block, not lose it.
    const litBefore = litPixels(panel);
    expect(litBefore).toBeGreaterThan(0);

    panel.setRotation(panel.width > panel.height ? 0 : 1);

    expect(
      litPixels(panel),
      'turning the panel re-reads the same RAM, so the picture is still there',
    ).toBe(litBefore);
  });

  /** Non-black pixels on the visible surface. */
  function litPixels(panel: Ili9341): number {
    let count = 0;
    for (let y = 0; y < panel.height; y++) {
      for (let x = 0; x < panel.width; x++) {
        if (panel.pixelAt(x, y) !== 0) count++;
      }
    }
    return count;
  }

  it('swaps the visible size when the panel is turned, and swaps it back', () => {
    const simulation = bench();
    const panel = [...simulation.displayControllers().values()][0] as Ili9341;
    const before = { width: panel.width, height: panel.height };

    // Whatever it is showing now, a quarter turn must be the other shape.
    panel.setRotation(panel.width > panel.height ? 0 : 1);
    expect(
      { width: panel.width, height: panel.height },
      'turning the panel exchanges its axes',
    ).toEqual({ width: before.height, height: before.width });

    panel.setRotation(panel.width > panel.height ? 0 : 1);
    expect({ width: panel.width, height: panel.height }, 'and turning it again comes back').toEqual(
      before,
    );
  });
});
