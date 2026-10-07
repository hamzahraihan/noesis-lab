/**
 *
 * Side panels: the inspector, the firmware editor and the serial monitor.
 *
 * Each is deliberately plain. The bench is the thing worth looking at; these
 * panels are instruments, and an instrument that needs explaining is a bad one.
 */

import Editor from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import type { PartInstance } from '../sim/bench';
import { DynamicState, type KnobSpec } from '../sim/catalog';
import { formatOhms, formatVolts } from '@/utils';
import { FIRMWARE_LANGUAGE, FIRMWARE_THEME, PYTHON_LANGUAGE } from './monaco-setup';
import type { FirmwareLanguage } from '../sim/firmware/interpreter';
import type { Example } from './examples';
import {
  CaretRightIcon,
  CodeIcon,
  CrossCircledIcon,
  CubeIcon,
  PlayIcon,
  ReaderIcon,
  ResetIcon,
  ResetIcon as RotateIcon,
  TargetIcon,
  TrashIcon,
  ValueIcon,
} from '@radix-ui/react-icons';

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------


export interface InspectorProps {
  part: PartInstance | null;
  pinVoltages: ReadonlyMap<string, number>;
  /** What the operator is doing to this part, read as the panel is drawn. */
  controls: DynamicState;
  onDelete(): void;
  onSetPressed(pressed: boolean): void;
  onSetKnob(spec: KnobSpec, value: number): void;
  /**
   * Turns the selected part a quarter turn, on the bench.
   *
   * Not a knob, and deliberately so: turning a part is a physical act with a
   * consequence for the circuit -- its pins land in different contacts -- so it
   * re-solves the netlist, which is what a knob would do anyway. Keeping it a
   * direct action makes that honest.
   */
  onRotate(): void;
  /** The colour panel's visible size, when the part is one. */
  panelSize?: string;
  /** Which way up the part is, in degrees. 0 is as it was drawn. */
  rotation: number;
}

export function Inspector({
  part,
  pinVoltages,
  controls,
  panelSize,
  rotation,
  onDelete,
  onRotate,
  onSetPressed,
  onSetKnob,
}: InspectorProps) {
  if (!part) {
    // An empty panel is the first thing a new operator sees, so it says what
    // to click and shows the glyph for the thing they'd click.
    return (
      <div className="flex flex-1 flex-col">
        <PanelTitle icon={<CubeIcon className="icon-sm" />} text="Inspector" />
        <div className="empty flex-1">
          <TargetIcon className="icon text-slate-700" aria-hidden="true" />
          <p>Select a part on the bench to read its pins and drive it.</p>
        </div>
      </div>
    );
  }

  const { definition } = part;
  const knobs = definition.knobs ?? [];
  // Only pins that carry a silkscreen label are worth a voltage readout; a
  // resistor's two leads would otherwise render an empty section header.
  const labelledPins = definition.pins.filter((pin) => pin.label !== '').slice(0, 32);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelTitle icon={<CubeIcon className="icon-sm" />} text="Inspector" />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{definition.name}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{definition.id}</p>
        </div>

        <dl className="flex flex-col gap-1 text-xs">
          <Row label="Pins" value={String(definition.pins.length)} />
          <Row label="Footprint" value={`${definition.widthMm} × ${definition.heightMm} mm`} />
          {definition.component.kind === 'resistor' && (
            <Row label="Resistance" value={formatOhms(definition.component.ohms)} />
          )}
          {definition.component.kind === 'led' && (
            <Row label="Forward voltage" value={`${definition.component.profile.forwardVolts} V`} />
          )}
        </dl>

        {labelledPins.length > 0 && (
          <div>
            <h3 className="panel-title mb-1.5">
              <ValueIcon className="icon-sm" aria-hidden="true" />
              Pin voltages
            </h3>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {labelledPins.map((pin) => (
                <li key={pin.id} className="flex justify-between gap-2">
                  <span className="truncate text-slate-500">{pin.label}</span>
                  <span className="num text-slate-200">
                    {formatVolts(pinVoltages.get(`${part.id}:${pin.id}`) ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {definition.momentary && (
          <button
            type="button"
            onMouseDown={() => onSetPressed(true)}
            onMouseUp={() => onSetPressed(false)}
            onMouseLeave={() => onSetPressed(false)}
            className={`ctl h-8 w-full text-xs ${
              controls.isPressed(part.id) ? '!bg-amber-400 !text-slate-900' : 'ctl-quiet'
            }`}
          >
            <ReaderIcon className="icon" aria-hidden="true" />
            {controls.isPressed(part.id) ? 'Pressed' : 'Press and hold'}
          </button>
        )}

        {knobs.map((spec) => (
          <KnobControl
            key={spec.id}
            spec={spec}
            value={controls.knob(part.id, spec)}
            onChange={(value) => onSetKnob(spec, value)}
          />
        ))}

        {/*
         * Turning a part is a physical act, so it belongs on every part rather
         * than on the displays alone -- a resistor is the part most worth
         * turning, since a quarter turn is what puts its leads in two different
         * rows of a breadboard.
         *
         * The button is labelled for what it does rather than what it is
         * called. `R` does the same thing, which is why the key is on the
         * button too: a part can be turned while the operator's attention is on
         * the board rather than the side panel.
         *
         * The screen readout stays below it for a colour panel, because there
         * is a second, unrelated rotation on a display -- the electronic one
         * the sketch asks for -- and a learner who cannot see the two apart
         * concludes neither works.
         */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onRotate}
            className="ctl ctl-quiet h-8 w-full text-xs"
            title="Turn this part a quarter turn clockwise (R)"
          >
            <RotateIcon className="icon" aria-hidden="true" />
            Turn part
            <span className="num ml-auto text-slate-400">{rotation}°</span>
          </button>
          {panelSize && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Screen</span>
              <span className="num text-slate-200">{panelSize}</span>
            </div>
          )}
        </div>

        <button type="button" onClick={onDelete} className="ctl ctl-danger mt-1 w-full">
          <TrashIcon className="icon" aria-hidden="true" />
          Remove part
        </button>
      </div>
    </div>
  );
}

/**
 * One of a part's controls.
 *
 * Every control arrives with the range and unit its part works in, so a new
 * sensor on the bench needs this written once rather than again for each one:
 * the panel has nothing left to decide beyond how to draw it.
 */
function KnobControl({
  spec,
  value,
  onChange,
}: {
  spec: KnobSpec;
  value: number;
  onChange(value: number): void;
}) {
  if (spec.toggle) {
    return (
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-400">{spec.label}</span>
        <input
          type="checkbox"
          className="ctl size-4 accent-amber-400"
          checked={value >= 1}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="flex items-center justify-between">
        <span className="text-slate-400">{spec.label}</span>
        <span className="num text-slate-200">{formatKnobValue(spec, value)}</span>
      </span>
      <input
        type="range"
        className="wiper"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/**
 * A knob's readout in the unit its part works in.
 *
 * A bare fraction of travel says nothing about what a sensor is reading, so
 * anything that has a unit of its own is shown in it.
 */
function formatKnobValue(spec: KnobSpec, value: number): string {
  if (spec.unit) return `${trimNumber(value)} ${spec.unit}`;
  return `${Math.round(((value - spec.min) / (spec.max - spec.min)) * 100)}%`;
}

/** Trims the float noise a slider's own step leaves behind. */
function trimNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every instrument's heading, so the panels read as one console.
 *
 * The glyph is part of the heading rather than decoration beside it: it is what
 * lets an operator find the serial monitor by shape while their eyes are on the
 * waveform.
 */
function PanelTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <h3 className="panel-title h-9 shrink-0 border-b border-slate-800 px-3">
      <span className="text-slate-500">{icon}</span>
      {text}
    </h3>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200 tabular-nums">{value}</dd>
    </div>
  );
}

export function SerialMonitor({ lines }: { lines: readonly string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="flex h-full flex-col">
      <PanelTitle icon={<ReaderIcon className="icon-sm" />} text="Serial Monitor" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-emerald-300">
        {lines.length === 0 ? (
          // Dim prose here read as a stalled instrument rather than an idle
          // one, so it names what would make the sketch start printing.
          <span className="font-sans text-slate-600">
            Serial.print and Serial.println output lands here.
          </span>
        ) : (
          // Serial.print fragments concatenate; only println breaks the line,
          // so the stream is joined before rendering rather than split per write.
          lines.join('')
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FirmwareEditor({
  value,
  error,
  language,
  expanded,
  onToggle,
  onChange,
  onChangeLanguage,
  onRun,
  onReset,
  running,
  examples,
  activeExampleId,
  onLoadExample,
}: {
  value: string;
  error: string | null;
  /** Which grammar the text in the editor is written in. */
  language: FirmwareLanguage;
  /** Whether the editor body is showing under its header. */
  expanded: boolean;
  onToggle(): void;
  onChange(next: string): void;
  onChangeLanguage(language: FirmwareLanguage): void;
  onRun(): void;
  onReset(): void;
  running: boolean;
  /** What an example brings with it, so the panel can offer it. */
  examples: readonly Example[];
  activeExampleId: string | null;
  onLoadExample(id: string): void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="panel-title transition-colors hover:text-slate-200"
        >
          <CaretRightIcon
            className={`icon-sm transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span className="text-slate-500">
            <CodeIcon className="icon-sm" aria-hidden="true" />
          </span>
          Firmware
        </button>

        {/*
         * Which grammar, stated rather than inferred. The two are not
         * interchangeable and neither is a subset of the other, so the editor
         * cannot pick one from the text and the bench cannot switch the board
         * under a sketch without saying so.
         */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Firmware language</span>
          <select
            value={language}
            onChange={(event) => onChangeLanguage(event.target.value as FirmwareLanguage)}
            className="ctl-select"
            aria-label="Firmware language"
            title={
              language === 'python'
                ? 'Python, with the gpiozero API. A Raspberry Pi runs this.'
                : 'An Arduino sketch. Runs on every microcontroller here.'
            }
          >
            <option value="arduino-cpp">C++</option>
            <option value="python">Python</option>
          </select>
        </label>
        {/*
         * An example carries its own wiring, so picking one replaces the
         * sketch *and* rebuilds the bench around it. Loading a sketch onto a
         * bench that has none of its parts teaches the wrong thing twice.
         */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Load an example</span>
          <select
            value={activeExampleId ?? ''}
            onChange={(event) => onLoadExample(event.target.value)}
            className="ctl-select max-w-44"
            aria-label="Load an example"
          >
            <option value="">Load an example…</option>
            {examples.map((example) => (
              <option key={example.id} value={example.id} title={example.note}>
                {example.name}
              </option>
            ))}
          </select>
        </label>

        <span className="flex-1" />
        {/*
         * One button that changes what it does, so the pair never sits side by
         * side claiming equal weight. Reset is deliberately the quiet
         * dressing: it discards run state, it does not start work.
         */}
        <button
          type="button"
          onClick={running ? onReset : onRun}
          className={`ctl ${running ? 'ctl-quiet' : 'ctl-accent'}`}
          title={running ? 'Reset the running sketch' : 'Run this sketch'}
        >
          {running ? (
            <ResetIcon className="icon" aria-hidden="true" />
          ) : (
            <PlayIcon className="icon" aria-hidden="true" />
          )}
          {running ? 'Reset' : 'Run'}
        </button>
      </div>

      {expanded && (
        <Editor
          height="100%"
          language={language === 'python' ? PYTHON_LANGUAGE : FIRMWARE_LANGUAGE}
          theme={FIRMWARE_THEME}
          value={value}
          onChange={(next) => onChange(next ?? '')}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 19,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: 'none',
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'off',
          }}
        />
      )}

      {error && (
        <p className="flex shrink-0 items-start gap-1.5 border-t border-red-900 bg-red-950 px-3 py-1.5 text-xs text-red-300">
          <CrossCircledIcon className="icon-sm mt-px shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StatusBar({
  timeMs,
  running,
  netCount,
}: {
  timeMs: number;
  running: boolean;
  netCount: number;
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-800 bg-slate-900 px-3 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        {/*
         * The lamp is the fastest read on the whole bench: it is the only
         * thing visible when the operator's eyes are on the breadboard, so it
         * pulses in step with the solver rather than sitting steady.
         */}
        <span className="relative flex size-2">
          {running && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={`relative inline-block size-2 rounded-full ${running ? 'bg-emerald-400' : 'bg-slate-600'}`}
          />
        </span>
        <span className={running ? 'text-slate-200' : ''}>{running ? 'Running' : 'Stopped'}</span>
      </span>
      <span className="num">t = {timeMs.toFixed(0)} ms</span>
      <span className="num">{netCount} nets</span>
      <span className="ml-auto hidden truncate text-slate-600 md:inline">
        Drag to move · wheel to zoom · shift-drag to pan
      </span>
    </footer>
  );
}
