/**
 * The debugger panel.
 *
 * A stop is a line in a sketch, and this is where the program says what it
 * can see there: the names it holds and what they are worth, and the three
 * things a person can ask of a stopped program -- carry on, step over the
 * call it is in, or step into it.
 *
 * When nothing is stopped the panel lists the stops instead, because a stop
 * that is set on a line the program has not reached yet is the only thing a
 * person can act on before the next run.
 */

import { memo } from 'react';
import type { Breakpoint, DebugFrame } from '@/features/simulation';
import { Button } from '@/components';

export interface DebugPanelProps {
  /** Where the program stopped, while it is stopped. */
  frame: DebugFrame | null;
  /** Every stop the person has set. */
  stops: readonly Breakpoint[];
  /**
   * Whether the run can be watched at all.
   *
   * The debugger reads the sketch the interpreter runs, so a compiled core
   * has nothing for it to stop in -- and saying so is better than a button
   * that does nothing.
   */
  watchable: boolean;
  onContinue(): void;
  onStepOver(): void;
  onStepInto(): void;
  onClear(): void;
}

export const DebugPanel = memo(function DebugPanel({
  frame,
  stops,
  watchable,
  onContinue,
  onStepOver,
  onStepInto,
  onClear,
}: DebugPanelProps) {
  return (
    <section className="flex h-full flex-col gap-2 px-3 py-2">
      {frame === null ? (
        <>
          <p className="font-sans text-xs text-[var(--hd-muted)]">
            {watchable
              ? 'The program is running. Set a stop in the margin and it will stop there.'
              : 'This run is on a compiled core, which the debugger cannot read. Stop it on the interpreted sketch.'}
          </p>
          {stops.length > 0 && (
            <ul className="font-mono text-xs text-[var(--hd-text)]">
              {stops.map((stop) => (
                <li key={`${stop.file}:${stop.line}`}>
                  {stop.file}:{stop.line}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--hd-text)]">
              {frame.file}:{frame.line}
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={onStepOver} title="Step over the call (F10)">
              Step over
            </Button>
            <Button size="sm" variant="secondary" onClick={onStepInto} title="Step into the call (F11)">
              Step into
            </Button>
            <Button size="sm" onClick={onContinue} title="Carry on to the next stop (F5)">
              Continue
            </Button>
          </div>
          <table className="w-full font-mono text-xs">
            <tbody>
              {frame.variables.map((variable) => (
                <tr key={`${variable.scope}:${variable.name}`}>
                  <td className="w-16 py-0.5 pr-2 text-[var(--hd-faint)]">{variable.scope}</td>
                  <td className="py-0.5 pr-2 text-[var(--hd-text)]">{variable.name}</td>
                  <td className="py-0.5 text-[var(--hd-muted)]">{variable.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {stops.length > 0 && (
        <div className="flex items-center gap-2 border-t border-[var(--hd-border)] pt-2">
          <span className="font-sans text-xs text-[var(--hd-faint)]">
            {stops.length} stop{stops.length === 1 ? '' : 's'} set
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={onClear} title="Take every stop off">
            Clear stops
          </Button>
        </div>
      )}
    </section>
  );
});
