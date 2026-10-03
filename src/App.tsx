/**
 * Noesis Lab workbench.
 *
 * The whole UI is a thin shell over `Simulation`: the bench model is mutable and
 * lives outside React, and the component tree re-renders from a version counter
 * each animation frame. Rendering a populated breadboard means walking nearly a
 * thousand terminals, so keeping that work out of the render path is the
 * difference between a smooth bench and a slideshow.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isLargePart, type CatalogueEntry } from './sim/catalogue';
import { ComponentBrowser } from './ui/ComponentBrowser';
import { breadboardDefinition, columnX, railRowY, stripRowY } from './sim/breadboard';
import { arduinoMega2560, arduinoNano, arduinoUnoR3, esp32DevKitV1, franzininhoBoard, nanoRp2040Connect } from './sim/boards';
import { ledDefinition, resistorDefinition } from './sim/passives';
import { DIODE_PROFILES } from './sim/elements';
import type { PartDefinition } from './sim/catalog';
import type { BendPoint, PartInstance, Terminal } from './sim/bench';
import { ili9341Definition, ssd1306Definition } from './sim/display/part';
import { Workbench } from './ui/Workbench';
import type { FootprintState } from './ui/footprints';
import { Simulation } from './ui/simulation';
import { BLINK_EXAMPLE, EXAMPLES } from './ui/examples';
import { PartSearch } from './ui/PartSearch';
import {
  FirmwareEditor,
  Inspector,
  SerialMonitor,
  StatusBar,
} from './ui/Panels';
import { ScopePanel } from './ui/Scope';
import { MultimeterPanel } from './ui/Multimeter';
import { LogicAnalyser } from './ui/LogicAnalyser';
import { BusMonitor } from './ui/BusMonitor';
import {
  CaretLeftIcon,
  Component1Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SwitchIcon,
} from '@radix-ui/react-icons';

type BoardId = 'esp32' | 'uno' | 'mega' | 'nano' | 'rp2040' | 'franzininho';

/**
 * The boards the bench can be built around, in the order they are offered.
 *
 * A list rather than two entries so a swap is a choice rather than a coin
 * toss, and so adding a board is one line here rather than a new branch in
 * every place that has to know which board it is looking at.
 */
const BOARDS: ReadonlyArray<{ id: BoardId; name: string; make: () => PartDefinition }> = [
  { id: 'esp32', name: 'ESP32 DevKit V1', make: esp32DevKitV1 },
  { id: 'uno', name: 'Arduino Uno R3', make: arduinoUnoR3 },
  { id: 'mega', name: 'Arduino Mega 2560', make: arduinoMega2560 },
  { id: 'nano', name: 'Arduino Nano', make: arduinoNano },
  { id: 'rp2040', name: 'Nano RP2040 Connect', make: nanoRp2040Connect },
  { id: 'franzininho', name: 'Franzininho', make: franzininhoBoard },
];

/** Where the breadboard sits, clear of the board plugged in beside it. */
const BREADBOARD_ORIGIN_X = 230;

/** Column the starter LED circuit is wired onto. */
const SIGNAL_COLUMN = 20;

/**
 * How the starter bench is wired onto each board.
 *
 * Every board here is wire-compatible with the Arduino pin numbers the sketch
 * talks in, so the starter circuit is the same circuit -- what differs is which
 * header pin carries it and which two carry I2C.
 */
interface StarterWiring {
 /** Header pin the blink sketch drives. */
 readonly led: string;
  /** Any pin of the board's ground plane. */
  readonly ground: string;
  /** SDA then SCL. */
 readonly i2c: readonly [string, string];
  /** Chip-select, D/C, clock and MOSI, in that order. */
  readonly spi: readonly [string, string, string, string];
}

const STARTER_WIRING: Readonly<Record<BoardId, StarterWiring>> = {
  esp32: { led: 'R_D2', ground: 'L_GND', i2c: ['R_D21', 'R_D22'], spi: ['R_D5', 'R_D15', 'R_D18', 'R_D23'] },
  uno: { led: 'J1_D13', ground: 'J1_GND', i2c: ['J3_A4', 'J3_A5'], spi: ['J1_D10', 'J1_D9', 'J1_D13', 'J1_D11'] },
  /*
   * The Mega's SPI is the 50-53 block its own peripheral sits on, not the
   * 10-13 an Uno sketch names, and its SDA and SCL holes are shadowed by the
   * numbered 20 and 21 beside them -- so the bus is wired to the numbered
   * pair, which is what a pin number resolves to.
   */
  mega: { led: 'J1_13', ground: 'J3_GND2', i2c: ['J1_20', 'J1_21'], spi: ['J2b_53', 'J1_9', 'J2a_52', 'J2b_51'] },
  nano: { led: 'J2_13', ground: 'J1_GND', i2c: ['J3_A4', 'J3_A5'], spi: ['J1_10', 'J1_9', 'J2_13', 'J1_11'] },
  /*
   * The RP2040's analog block silkscreens A0-A3 on the GPIO its ADC samples,
   * so that is what the I2C pair is wired to. A4 and A5 name those same two
   * holes as their I2C aliases but carry no pin number of their own.
   */
  rp2040: { led: 'J2_D13', ground: 'J1_GND', i2c: ['J3_A0', 'J3_A1'], spi: ['J1_D10', 'J1_D9', 'J2_D13', 'J1_D11'] },
  /*
   * The Franzininho is an ATmega328P on a small carrier with no digital header
   * of its own, so its buses sit on the port bits: PB2/PB3 are the USI's I2C,
   * which is the pair the chip's own pins 2 and 3 already are.
   */
  franzininho: { led: 'J1_PB1', ground: 'J1_GND.1', i2c: ['J1_PB2', 'J1_PB3'], spi: ['J1_PB0', 'J1_PB5', 'J1_PB4', 'J1_PB3'] },
};

function boardDefinition(boardId: BoardId): PartDefinition {
  const board = BOARDS.find((candidate) => candidate.id === boardId);
  if (!board) throw new Error(`unknown board ${boardId}`);
  return board.make();
}

/** A terminal-shaped placeholder, for routing wires before a hole exists. */
function at(x: number, y: number): Terminal {
  return { id: -1, x, y };
}

/**
 * Builds the bench the app opens with: a board, a breadboard, a blinking LED,
 * an OLED on I2C and a TFT on SPI.
 *
 * Both displays are wired through to the controller pins their buses actually
 * run on. Pull a wire and that screen goes dark while the other carries on,
 * which is the whole reason they are both here.
 */
function buildStartingBench(simulation: Simulation, boardId: BoardId): void {
  const wiring = STARTER_WIRING[boardId];
  const board = simulation.addPart(boardDefinition(boardId), 0, 0);
  simulation.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);

  const pinAt = (id: string) => {
    const pin = board.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`${board.definition.name} has no pin ${id}`);
    return pin;
  };
  const holeX = (column: number) => BREADBOARD_ORIGIN_X + columnX(column);
  const holeY = (row: number) => stripRowY(row);
  const groundRailY = railRowY(2);

  // --- LED on the bench ---------------------------------------------------
  const ledPin = pinAt(wiring.led);
  simulation.routeWire(at(ledPin.x, ledPin.y), at(holeX(SIGNAL_COLUMN), holeY(8)));
  simulation.addPart(resistorDefinition(330), holeX(SIGNAL_COLUMN), holeY(8) - 1.6);
  simulation.addPart(
    ledDefinition(DIODE_PROFILES.red, 'Red'),
    holeX(SIGNAL_COLUMN + 4),
    holeY(8) - 3,
  );
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 5), holeY(8)),
    at(holeX(SIGNAL_COLUMN + 5), groundRailY),
  );
  const ground = pinAt(wiring.ground);
  simulation.routeWire(at(ground.x, ground.y), at(holeX(10), groundRailY));

  /** Wires a display pin to a breadboard column, and the board pin to it too. */
  const connect = (display: PartInstance, pin: string, column: number, row: number) => {
    const spec = display.definition.pins.find((candidate) => candidate.id === pin);
    if (!spec) throw new Error(`${display.definition.name} has no pin ${pin}`);
    simulation.routeWire(
      at(holeX(column), holeY(row)),
      at(display.x + spec.x, display.y + spec.y),
    );
  };

  // --- 128x64 OLED, on I2C ------------------------------------------------
  const oled = simulation.addPart(ssd1306Definition(), BREADBOARD_ORIGIN_X + 40, 86);
  const oledColumn = SIGNAL_COLUMN + 7;
  connect(oled, 'SDA', oledColumn, 8);
  connect(oled, 'SCL', oledColumn + 2, 8);
  simulation.routeWire(
    at(holeX(oledColumn), groundRailY),
    at(oled.x + oled.definition.pins[1].x, oled.y + oled.definition.pins[1].y),
  );
  simulation.routeWire(
    at(holeX(oledColumn + 2), groundRailY),
    at(oled.x + oled.definition.pins[0].x, oled.y + oled.definition.pins[0].y),
  );
  [wiring.i2c[0], wiring.i2c[1]].forEach((boardPin, index) => {
    const pin = pinAt(boardPin);
    simulation.routeWire(at(pin.x, pin.y), at(holeX(oledColumn + index * 2), holeY(8)));
  });

  // --- 2.4" TFT, on SPI ---------------------------------------------------
  const tft = simulation.addPart(ili9341Definition(), BREADBOARD_ORIGIN_X + 55, 150);
  const spiColumn = SIGNAL_COLUMN + 13;
  ['CS', 'DC', 'SCK', 'MOSI'].forEach((signal, index) => {
    const column = spiColumn + index * 2;
    const pin = pinAt(wiring.spi[index]);
    simulation.routeWire(at(pin.x, pin.y), at(holeX(column), holeY(8)));
    connect(tft, signal, column, 8);
  });
  connect(tft, 'VCC', spiColumn, 4);
  connect(tft, 'GND', spiColumn + 2, 4);
}

/**
 * Where dropped parts land.
 *
 * Small parts go onto the breadboard's row-e strip, spaced far enough apart not
 * to sit on each other. Anything board-sized goes on the bench below instead,
 * because dropping a breadboard onto a breadboard would just hide it.
 */
let nextDropColumn = 44;
let nextBenchSlot = 0;

const BENCH_SLOTS_X = [230, 240, 250, 260, 270, 280];
const BENCH_SLOTS_Y = [70, 78, 86];

/**
 * Offset of a part's first pin inside its own footprint.
 *
 * Dropping a part means landing its leads in holes, and where the leads sit
 * inside the footprint differs per part: a resistor's are 1.6 mm down, an
 * LED's are 3 mm and a potentiometer's 4.5 mm. Dropping the origin on the
 * strip row instead is what left half the palette floating above the board.
 */
function offsetOfFirstPin(definition: PartDefinition): [x: number, y: number] {
  let x = Infinity;
  let y = Infinity;
  for (const pin of definition.pins) {
    if (pin.x < x) x = pin.x;
    if (pin.y < y) y = pin.y;
  }
  return [x, y];
}

export default function App() {
  const [firmware, setFirmware] = useState(BLINK_EXAMPLE.sketch);
  const [exampleId, setExampleId] = useState<string | null>(BLINK_EXAMPLE.id);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [boardId, setBoardId] = useState<BoardId>('esp32');
  const [, forceRender] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wireMode, setWireMode] = useState(false);
  const [firmwareOpen, setFirmwareOpen] = useState(true);

  // Rebuilt on board change only: a sketch's pin numbers mean something
  // different on each board, so carrying one across would silently misfire.
  const simulation = useMemo(
    () => {
      const created = new Simulation(boardDefinition(boardId));
      buildStartingBench(created, boardId);
      created.loadFirmware(BLINK_EXAMPLE.sketch);
      // Deliberately left stopped. The bench opens on a loaded sketch at
      // t=0 that the operator has to run themselves, which is the honest
      // initial state -- starting the moment the page loads ran the firmware
      // before anyone had looked at it, and left the status lamp claiming
      // "running" over a simulation nobody had started.
      return created;
    },
    [boardId],
  );


  const [baud, setBaud] = useState(9600);

  // Only pins firmware can actually name are worth probing; the power and
  // ground headers are rails, not signals.
  const probePins = useMemo(
    () => simulation.mcu.pins().filter((pin) => pin.role === 'gpio' || pin.role === 'adc'),
    [simulation],
  );
  // One animation frame drives both the firmware and the circuit solver. The
  // wall-clock delta is what keeps simulated time honest: without it the bench

  // would advance as fast as the solver could go, not as fast as real time.
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - previous) / 1000, 0.25);
      previous = now;
      simulation.tick(deltaSeconds);
      forceRender((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [simulation]);

  /*
   * The four controls an operator reaches for while watching a sketch run were
   * all mouse-only, and every one of them is a single keystroke's worth of work.
   *
   * Keys are ignored whenever focus is in a text field: pressing `w` has to
   * type a `w`, not arm the wire tool mid-sketch.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (event.key) {
        case ' ':
          event.preventDefault();
          if (simulation.running) simulation.stop();
          else simulation.start();
          forceRender((n) => n + 1);
          break;
        case 'w':
          setWireMode((mode) => !mode);
          break;
        case 'b':
          setSidebarOpen((open) => !open);
          break;
        case 'c':
          setBrowserOpen(true);
          break;
        case 'Escape':
          // Escape backs out of the mode you are in, deepest first, so it
          // never leaves the bench armed for wiring with no way back.
          if (browserOpen) setBrowserOpen(false);
          else if (wireMode) setWireMode(false);
          else if (selectedId) setSelectedId(null);
          else if (firmwareOpen) setFirmwareOpen(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [simulation, browserOpen, wireMode, selectedId, firmwareOpen]);


  const bench = simulation.bench;

  /*
   * Rebuilt when the bench changes, not only when the simulation does, because
   * an example adds its parts to a simulation that already exists: keyed on the
   * simulation alone this map would never learn about a display that arrived
   * later, and its artwork would sit on the bench showing whatever it was
   * constructed with.
   */
  const renderState = useMemo<FootprintState>(
    () => ({
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
      servos: simulation.servoModels(),
      lcds: simulation.lcdModels(),
      controls: simulation.controls,
      // Read here so the memo is honest about depending on the bench: the maps
      // above are built from it, and an example changes it without touching
      // the simulation.
      parts: bench.parts.length,
    }),
    [simulation, bench],
  );


  // Meter probes come from the same pin list as the scope's. The black probe
  // defaults to bench ground, which is where it sits when unclipped.
  const [meterRedPin, setMeterRedPin] = useState<string | null>(null);
  const [meterBlackPin, setMeterBlackPin] = useState<string | null>(null);

  useEffect(() => {
    simulation.setMeterProbes(
      meterRedPin ? simulation.engine.netOfMcuPin(meterRedPin) : null,
      meterBlackPin ? simulation.engine.netOfMcuPin(meterBlackPin) : null,
    );
  }, [simulation, meterRedPin, meterBlackPin]);

  // The meter can be clipped anywhere, including the power rails -- measuring
  // rail current is one of the main reasons to reach for it. The scope stays
  // limited to signal pins, where a trace is actually interesting.
  const meterPins = useMemo(() => simulation.mcu.pins(), [simulation]);

  const meterRedLabel = meterPins.find((pin) => pin.id === meterRedPin)?.label ?? null;
  const meterBlackLabel = meterPins.find((pin) => pin.id === meterBlackPin)?.label ?? null;


  const netOfTerminal = useMemo(() => {
    const netlist = simulation.engine.currentNetlist;
    const map = new Map<number, number>();
    for (const terminal of bench.terminals) {
      map.set(terminal.id, netlist.nodeOfTerminal[terminal.id]);
    }
    return map;
  }, [bench, simulation]);

  const selected = bench.parts.find((part) => part.id === selectedId) ?? null;

  const onMovePart = useCallback(
    (partId: string, x: number, y: number) => {
      simulation.movePart(partId, Math.round(x), Math.round(y));
    },
    [simulation],
  );

  const onRouteWire = useCallback(
    (from: Terminal, to: Terminal, bends: readonly BendPoint[]) =>
      simulation.routeWire(from, to, bends),
    [simulation],
  );

  const onSetWireBends = useCallback(
    (wireId: string, bends: readonly BendPoint[]) => {
      simulation.setWireBends(wireId, bends);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const onRemoveWireBend = useCallback(
    (wireId: string, index: number) => {
      simulation.removeWireBend(wireId, index);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const onInsertWireBend = useCallback(
    (wireId: string, index: number, bend: BendPoint) => {
      simulation.insertWireBend(wireId, index, bend);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const bendIndexNear = useCallback(
    (wireId: string, x: number, y: number) => simulation.bendIndexNear(wireId, x, y),
    [simulation],
  );

  const onTogglePressed = useCallback(
    (partId: string, pressed: boolean) => simulation.setPressed(partId, pressed),
    [simulation],
  );

  /**
   * Loads an example: the sketch, and the bench it expects to find.
   *
   * Both halves or neither. A sketch that talks to a clock nobody wired reads
   * nothing and looks exactly like a broken API, so the parts go down first and
   * the sketch is loaded onto them. The bench keeps the board and the breadboard
   * and everything already wired to them, because the examples share the
   * displays and the clock that one of them reads.
   */
  const loadExample = useCallback(
    (id: string) => {
      const example = EXAMPLES.find((candidate) => candidate.id === id);
      if (!example) return;
      example.wire(simulation);
      setFirmware(example.sketch);
      setExampleId(example.id);
      simulation.loadFirmware(example.sketch);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const onPlacePart = useCallback(
    (definition: PartDefinition, entry: CatalogueEntry) => {
      const part = isLargePart(entry.id)
        ? (() => {
            const slot = nextBenchSlot++;
            return simulation.addPart(
              definition,
              BENCH_SLOTS_X[slot % BENCH_SLOTS_X.length],
              BENCH_SLOTS_Y[Math.floor(slot / BENCH_SLOTS_X.length) % BENCH_SLOTS_Y.length],
            );
          })()
        : (() => {
            const column = nextDropColumn;
            nextDropColumn = (nextDropColumn + 8) % 60;
            /*
             * Land the part's topmost, leftmost pin on a real hole rather than
             * its origin. Every part's leads sit at a different offset inside
             * its own footprint, so dropping the origin on the hole row left
             * everything but the resistor hanging in mid-air.
             */
            const [pinX, pinY] = offsetOfFirstPin(definition);
            return simulation.addPart(
              definition,
              BREADBOARD_ORIGIN_X + columnX(column) - pinX,
              stripRowY(8) - pinY,
            );
          })();
      setSelectedId(part.id);
    },
    [simulation],
  );

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/*
       * Three groups, left to right: what bench you are on, what the simulation
       * is doing, then what you can reach. The old header ran them together as
       * five equal buttons, so stopping the firmware and opening the parts
       * browser looked like the same kind of act.
       */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-800 pr-3 pl-4">
        <h1 className="text-sm font-semibold tracking-tight">Noesis Lab</h1>

        <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
          <span className="text-slate-500" aria-hidden="true">
            <Component1Icon className="icon" />
          </span>
          <select
            value={boardId}
            onChange={(event) => setBoardId(event.target.value as BoardId)}
            className="ctl-select"
            aria-label="Board"
            title="Swap board"
          >
            {BOARDS.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (simulation.running) simulation.stop();
              else simulation.start();
              forceRender((n) => n + 1);
            }}
            className="ctl ctl-quiet"
            title={simulation.running ? 'Pause the simulation (Space)' : 'Run the simulation (Space)'}
          >
            {simulation.running ? (
              <PauseIcon className="icon" aria-hidden="true" />
            ) : (
              <PlayIcon className="icon" aria-hidden="true" />
            )}
            {simulation.running ? 'Pause' : 'Run'}
          </button>
        </div>

        <span className="flex-1" />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWireMode((mode) => !mode)}
            aria-pressed={wireMode}
            className="ctl"
            title="Drag between two terminals to route a jumper (W)"
          >
            <SwitchIcon className="icon" aria-hidden="true" />
            {wireMode ? 'Wiring…' : 'Wire tool'}
          </button>
          <button
            type="button"
            onClick={() => setBrowserOpen(true)}
            className="ctl ctl-accent"
            title="Browse every part the bench can hold (C)"
          >
            <PlusIcon className="icon" aria-hidden="true" />
            Components
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
         * The bench is the product, so the canvas takes every pixel the panels
         * do not need and each panel steps aside when the window is too narrow
         * to hold it. Four fixed columns on a laptop screen left the canvas
         * about a fifth of the width, which is what made the whole thing read
         * as broken.
         */}
        {/*
         * The sidebar collapses to a slim rail rather than disappearing.
         *
         * It used to step aside under the `lg` breakpoint, which meant a
         * laptop could reach the bench but could not reach the parts list at
         * all. A rail costs almost nothing and keeps the toggle discoverable.
         */}
        <aside
          className={`flex shrink-0 flex-col border-r border-slate-800 bg-slate-900 transition-[width] ${
            sidebarOpen ? 'w-56' : 'w-9'
          }`}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Collapse the parts sidebar' : 'Expand the parts sidebar'}
            title={`${sidebarOpen ? 'Collapse' : 'Expand'} sidebar (B)`}
            className="flex h-9 shrink-0 items-center justify-center border-b border-slate-800 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <CaretLeftIcon
              className={`icon transition-transform ${sidebarOpen ? '' : 'rotate-180'}`}
              aria-hidden="true"
            />
          </button>
          {sidebarOpen && (
            <PartSearch onPlace={onPlacePart} onBrowse={() => setBrowserOpen(true)} />
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Workbench
              bench={bench}
              renderState={renderState}
              netOfTerminal={netOfTerminal}
              selectedId={selectedId}
              wireMode={wireMode}
              onSelect={setSelectedId}
              onMovePart={onMovePart}
              onRouteWire={onRouteWire}
              onTogglePressed={onTogglePressed}
              onSetWireBends={onSetWireBends}
              onRemoveWireBend={onRemoveWireBend}
              onInsertWireBend={onInsertWireBend}
              bendIndexNear={bendIndexNear}
            />
          </div>

          {/*
           * The editor lives under the bench rather than beside it. A wide
           * text area does not need a tall column, and a landscape bench on a
           * landscape canvas frames the whole board without zooming out.
           */}
          <section
            className={`flex shrink-0 flex-col border-t border-slate-800 bg-slate-900 ${
              firmwareOpen ? 'h-[42%]' : ''
            }`}
          >
            <FirmwareEditor
              value={firmware}
              error={simulation.firmwareError}
              expanded={firmwareOpen}
              onToggle={() => setFirmwareOpen((open) => !open)}
              onChange={setFirmware}
              onRun={() => {
                simulation.loadFirmware(firmware);
                simulation.start();
                forceRender((n) => n + 1);
              }}
              onReset={() => {
                simulation.reset();
                forceRender((n) => n + 1);
              }}
              running={simulation.running}
              examples={EXAMPLES}
              activeExampleId={exampleId}
              onLoadExample={loadExample}
            />
          </section>
        </main>

        <aside className="hidden w-60 shrink-0 flex-col border-l border-slate-800 bg-slate-900 lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Inspector
              part={selected}
              pinVoltages={renderState.pinVolts}
              controls={simulation.controls}
              onDelete={() => {
                if (selected) simulation.removePart(selected.id);
                setSelectedId(null);
              }}
              onSetPressed={(pressed) => {
                if (selected) simulation.setPressed(selected.id, pressed);
              }}
              onSetKnob={(spec, value) => {
                if (selected) simulation.setKnob(selected.id, spec, value);
              }}
            />
          </div>

          <div className="h-40 shrink-0 border-t border-slate-800">
            <SerialMonitor lines={simulation.serialLines()} />
          </div>
        </aside>

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900 xl:block">
          <ScopePanel
            pins={probePins}
            baud={baud}
            probePinId={simulation.probePinId}
            samples={simulation.probeTrace()}
            logicVolts={simulation.mcu.board.logicVolts}
            onProbe={(pinId: string | null) => simulation.setProbePin(pinId)}
            onBaud={setBaud}
          />
          <LogicAnalyser
            pins={probePins}
            traces={simulation.analyserTraces()}
            logicVolts={simulation.mcu.board.logicVolts}
            onTogglePin={(pinId) => simulation.toggleAnalysedPin(pinId)}
            isCapturing={(pinId) => simulation.isPinAnalysed(pinId)}
          />
          <BusMonitor entries={simulation.busLines()} onClear={() => simulation.clearBusLog()} />
          <MultimeterPanel
            pins={meterPins}
            redPinId={meterRedPin}
            blackPinId={meterBlackPin}
            onRedPin={setMeterRedPin}
            onBlackPin={setMeterBlackPin}
            mode={simulation.meterMode}
            reading={simulation.meterReading()}
            redLabel={meterRedLabel ?? 'not clipped'}
            blackLabel={meterBlackLabel ?? 'ground'}
            rangeId={simulation.meterRangeId}
            onMode={(mode) => simulation.setMeterMode(mode)}
            onRange={(rangeId: string) => simulation.setMeterRange(rangeId)}
          />
        </aside>

      {browserOpen && (
        <ComponentBrowser
          onPlace={(definition, entry) => {
            onPlacePart(definition, entry);
            setBrowserOpen(false);
          }}
          onClose={() => setBrowserOpen(false)}
        />
      )}

      </div>

      <StatusBar
        timeMs={simulation.engine.timeMs}
        running={simulation.running}
        netCount={simulation.engine.currentNetlist.nodeCount}
      />
    </div>
  );
}