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
import { arduinoUnoR3, esp32DevKitV1 } from './sim/boards';
import { ledDefinition, resistorDefinition } from './sim/passives';
import { DIODE_PROFILES } from './sim/elements';
import type { PartDefinition } from './sim/catalog';
import type { PartInstance, Terminal } from './sim/bench';
import { ili9341Definition, ssd1306Definition } from './sim/display/part';
import { Workbench } from './ui/Workbench';
import type { FootprintState } from './ui/footprints';
import { BLINK_SKETCH, Simulation } from './ui/simulation';
import {
  FirmwareEditor,
  Inspector,
  PartPalette,
  SerialMonitor,
  StatusBar,
} from './ui/Panels';
import { ScopePanel } from './ui/Scope';
import { MultimeterPanel } from './ui/Multimeter';

type BoardId = 'esp32' | 'uno';

/** Where the breadboard sits, clear of the board plugged in beside it. */
const BREADBOARD_ORIGIN_X = 230;

/** Column the starter LED circuit is wired onto. */
const SIGNAL_COLUMN = 20;

/** Which header pin drives the starter LED on each board. */
const LED_PIN: Readonly<Record<BoardId, string>> = {
  esp32: 'R_D2',
  uno: 'J1_D13',
};

/** Header pins carrying the TFT's four SPI signals on each board. */
const SPI_PINS: Readonly<Record<BoardId, ReadonlyArray<[string, string]>>> = {
  esp32: [
    ['R_D5', 'CS'],
    ['R_D15', 'DC'],
    ['R_D18', 'SCK'],
    ['R_D23', 'MOSI'],
  ],
  uno: [
    ['J1_D10', 'CS'],
    ['J1_D9', 'DC'],
    ['J1_D13', 'SCK'],
    ['J1_D11', 'MOSI'],
  ],
};

function boardDefinition(boardId: BoardId): PartDefinition {
  return boardId === 'esp32' ? esp32DevKitV1() : arduinoUnoR3();
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
  const ledPin = pinAt(LED_PIN[boardId]);
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
  const ground = pinAt(boardId === 'esp32' ? 'L_GND' : 'J1_GND');
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
  const i2cPins: readonly [string, string][] =
    boardId === 'esp32' ? [['R_D21', 'SDA'], ['R_D22', 'SCL']] : [['J3_A4', 'SDA'], ['J3_A5', 'SCL']];
  i2cPins.forEach(([boardPin, _signal], index) => {
    const pin = pinAt(boardPin);
    simulation.routeWire(at(pin.x, pin.y), at(holeX(oledColumn + index * 2), holeY(8)));
  });

  // --- 2.4" TFT, on SPI ---------------------------------------------------
  const tft = simulation.addPart(ili9341Definition(), BREADBOARD_ORIGIN_X + 55, 150);
  const spiColumn = SIGNAL_COLUMN + 13;
  SPI_PINS[boardId].forEach(([boardPin, signal], index) => {
    const column = spiColumn + index * 2;
    const pin = pinAt(boardPin);
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
  const [firmware, setFirmware] = useState(BLINK_SKETCH);
  const [browserOpen, setBrowserOpen] = useState(false);
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
      created.loadFirmware(BLINK_SKETCH);
      created.start();
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


  const bench = simulation.bench;

  const renderState = useMemo<FootprintState>(
    () => ({
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
      pressedButtons: new Set(
        bench.parts
          .filter((part) => part.definition.component.kind === 'button')
          .filter((part) => simulation.isButtonPressed(part.id))
          .map((part) => part.id),
      ),
      potPositions: new Map(
        bench.parts
          .filter((part) => part.definition.component.kind === 'potentiometer')
          .map((part) => [part.id, simulation.potPosition(part.id)]),
      ),
    }),
    [bench, simulation],
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
    (from: Terminal, to: Terminal) => simulation.routeWire(from, to),
    [simulation],
  );

  const onTogglePressed = useCallback(
    (partId: string, pressed: boolean) => simulation.setButtonPressed(partId, pressed),
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
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">Noesis Lab</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">

          {simulation.mcu.board.name}
        </span>
        <button
          type="button"
          onClick={() => setWireMode((mode) => !mode)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            wireMode
              ? 'bg-sky-500 text-slate-900'
              : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
          }`}
        >
          {wireMode ? 'Wiring…' : 'Wire tool'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (simulation.running) simulation.stop();
            else simulation.start();
            forceRender((n) => n + 1);
          }}
          className="rounded bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-600"
        >
          {simulation.running ? 'Pause' : 'Resume'}
        </button>
        <button
          type="button"
          onClick={() => setBoardId((current) => (current === 'esp32' ? 'uno' : 'esp32'))}
          className="rounded bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-600"
        >
          Swap board
        </button>
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-500"
        >
          Components
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
         * The bench is the product, so the canvas takes every pixel the panels
         * do not need and each panel steps aside when the window is too narrow
         * to hold it. Four fixed columns on a laptop screen left the canvas
         * about a fifth of the width, which is what made the whole thing read
         * as broken.
         */}
        <aside className="hidden w-44 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900 lg:block">
          <PartPalette onPlace={onPlacePart} onBrowse={() => setBrowserOpen(true)} />
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
            />
          </section>
        </main>

        <aside className="hidden w-60 shrink-0 flex-col border-l border-slate-800 bg-slate-900 lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Inspector
              part={selected}
              pinVoltages={renderState.pinVolts}
              pressed={selected ? simulation.isButtonPressed(selected.id) : false}
              potPosition={selected ? simulation.potPosition(selected.id) : 0.5}
              onDelete={() => {
                if (selected) simulation.removePart(selected.id);
                setSelectedId(null);
              }}
              onTogglePressed={(pressed) => {
                if (selected) simulation.setButtonPressed(selected.id, pressed);
              }}
              onSetPot={(fraction) => {
                if (selected) simulation.setPotPosition(selected.id, fraction);
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