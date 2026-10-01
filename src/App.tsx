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
import { breadboardDefinition, columnX, railRowY, stripRowY } from './sim/breadboard';
import { arduinoUnoR3, esp32DevKitV1 } from './sim/boards';
import { ledDefinition, resistorDefinition } from './sim/passives';
import { DIODE_PROFILES } from './sim/elements';
import type { PartDefinition } from './sim/catalog';
import type { Terminal } from './sim/bench';
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

type BoardId = 'esp32' | 'uno';

/** Where the breadboard sits, clear of the board plugged in beside it. */
const BREADBOARD_ORIGIN_X = 230;

/** Signal column the starter LED circuit is wired onto. */
const SIGNAL_COLUMN = 20;

/** Which header pin drives the starter LED on each board. */
const LED_PIN: Readonly<Record<BoardId, string>> = {
  esp32: 'R_D2',
  uno: 'J1_D13',
};

function boardDefinition(boardId: BoardId): PartDefinition {
  return boardId === 'esp32' ? esp32DevKitV1() : arduinoUnoR3();
}

/** A terminal-shaped placeholder, for routing wires before a hole exists. */
function at(x: number, y: number): Terminal {
  return { id: -1, x, y };
}

/**
 * Builds the bench the app opens with: a board, a breadboard, and a blinking
 * LED wired pin -> resistor -> LED -> ground. Starting populated means the first
 * thing on screen is the thing the tool is actually for.
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

  // Pin -> column 20 of the bottom strip.
  const ledPin = pinAt(LED_PIN[boardId]);
  simulation.routeWire(at(ledPin.x, ledPin.y), at(holeX(SIGNAL_COLUMN), holeY(8)));

  // 330 Ohm across columns 20 to 24, then the LED on to the next column.
  simulation.addPart(resistorDefinition(330), holeX(SIGNAL_COLUMN), holeY(8) - 1.6);
  simulation.addPart(ledDefinition(DIODE_PROFILES.red, 'Red'), holeX(SIGNAL_COLUMN + 4), holeY(8) - 3);

  // LED cathode to the bottom ground rail, and the board's own ground to it.
  const groundRailY = railRowY(2);
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 5), holeY(8)),
    at(holeX(SIGNAL_COLUMN + 5), groundRailY),
  );
  const ground = pinAt(boardId === 'esp32' ? 'L_GND' : 'J1_GND');
  simulation.routeWire(at(ground.x, ground.y), at(holeX(10), groundRailY));
}

function createSimulation(boardId: BoardId, firmware: string): Simulation {
  const simulation = new Simulation(boardDefinition(boardId));
  buildStartingBench(simulation, boardId);
  simulation.loadFirmware(firmware);
  simulation.start();
  return simulation;
}

/** Dropped parts walk along the breadboard so they do not land on each other. */
let nextDropColumn = 44;

export default function App() {
  const [firmware, setFirmware] = useState(BLINK_SKETCH);
  const [boardId, setBoardId] = useState<BoardId>('esp32');
  const simulation = useMemo(
    () => createSimulation(boardId, firmware),
    // Rebuilding on board change is deliberate: pin numbers genuinely differ,
    // so carrying a sketch across would silently target the wrong pins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId],
  );

  const [, forceRender] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wireMode, setWireMode] = useState(false);

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
    (from: Terminal, to: Terminal) => {
      simulation.routeWire(from, to);
    },
    [simulation],
  );

  const onPlacePart = useCallback(
    (definition: PartDefinition) => {
      const column = nextDropColumn;
      nextDropColumn = (nextDropColumn + 8) % 60;
      const part = simulation.addPart(
        definition,
        BREADBOARD_ORIGIN_X + columnX(column),
        stripRowY(8) - 1.6,
      );
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
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900">
          <PartPalette onPlace={onPlacePart} />
        </aside>

        <main className="min-w-0 flex-1">
          <Workbench
            bench={bench}
            renderState={renderState}
            netOfTerminal={netOfTerminal}
            selectedId={selectedId}
            wireMode={wireMode}
            onSelect={setSelectedId}
            onMovePart={onMovePart}
            onRouteWire={onRouteWire}
          />
        </main>

        <aside className="flex w-60 shrink-0 flex-col border-l border-slate-800 bg-slate-900">
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

        <aside className="w-96 shrink-0 border-l border-slate-800 bg-slate-900">
          <FirmwareEditor
            value={firmware}
            error={simulation.firmwareError}
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
        </aside>
      </div>

      <StatusBar
        timeMs={simulation.engine.timeMs}
        running={simulation.running}
        netCount={simulation.engine.currentNetlist.nodeCount}
      />
    </div>
  );
}