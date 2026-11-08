/**
 * The debugger panel.
 *
 * A stop is a line in a sketch, and this is where the program says what it
 * can see there: the names it holds and what they are worth, and the three
 * things a person can ask of a stopped program -- carry on, step over the
 * call it is in, or step into it.
 *
 * Compiled AVR firmware carries source lines and DWARF variables, so a
 * compiled stop shows the sketch's names, the register file and an SRAM
 * snapshot. The same buttons ask the same questions of either backend.
 *
 * When nothing is stopped the panel lists the stops instead, because a stop
 * that is set on a line the program has not reached yet is the only thing a
 * person can act on before the next run.
 */

import { memo, useState, useCallback } from 'react';
import type { Breakpoint, DebugFrame } from '@/features/simulation';
import { Button } from '@/components';
import { memoryRows } from './memory';

export interface DebugPanelProps {
  /** Where the program stopped, while it is stopped. */
  frame: DebugFrame | null;
  /** Every stop the person has set. */
  stops: readonly Breakpoint[];
  /**
   * Whether the run can be watched at all.
   *
   * The interpreter always can. A compiled AVR run can when its build carried
   * DWARF source rows; an RP2040 or ESP32 run cannot.
   */
  watchable: boolean;
  /** Whether the owning backend is compiled firmware. */
  compiled: boolean;
  onContinue(): void;
  onStepOver(): void;
  onStepInto(): void;
  onClear(): void;
  /** Reads `length` bytes from the AVR data space at `address`. */
  onReadMemory?: (address: number, length: number) => number[] | Promise<number[]>;
  /** Adds a write watchpoint on `[address, address + size)`. Returns id or -1. */
  onAddWatchpoint?: (address: number, size: number) => number | Promise<number>;
  /** Removes a watchpoint by id. */
  onRemoveWatchpoint?: (id: number) => boolean | Promise<boolean>;
  /** Sends a GDB remote protocol packet and returns the response. */
  onGdbPacket?: (payload: string) => string | Promise<string>;
}

export const DebugPanel = memo(function DebugPanel({
  frame,
  stops,
  watchable,
  compiled,
  onContinue,
  onStepOver,
  onStepInto,
  onClear,
  onReadMemory,
  onAddWatchpoint,
  onRemoveWatchpoint,
  onGdbPacket,
}: DebugPanelProps) {
  // Memory read state.
  const [readAddr, setReadAddr] = useState('0x100');
  const [readResult, setReadResult] = useState<number[] | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  // Watchpoint state.
  const [wpAddr, setWpAddr] = useState('0x100');
  const [wpSize, setWpSize] = useState('1');
  const [watchpoints, setWatchpoints] = useState<Array<{ id: number; address: number; size: number }>>([]);

  // GDB state.
  const [gdbCmd, setGdbCmd] = useState('');
  const [gdbResp, setGdbResp] = useState('');
  const [gdbBusy, setGdbBusy] = useState(false);

  const doReadMemory = useCallback(async () => {
    if (!onReadMemory) return;
    const addr = parseInt(readAddr, 16);
    if (!Number.isFinite(addr)) return;
    setReadBusy(true);
    try {
      const bytes = await onReadMemory(addr, 16);
      setReadResult(bytes);
    } finally {
      setReadBusy(false);
    }
  }, [onReadMemory, readAddr]);

  const doAddWatchpoint = useCallback(async () => {
    if (!onAddWatchpoint) return;
    const addr = parseInt(wpAddr, 16);
    const size = parseInt(wpSize, 10);
    if (!Number.isFinite(addr) || !Number.isFinite(size) || size < 1) return;
    const id = await onAddWatchpoint(addr, size);
    if (id > 0) {
      setWatchpoints((prev) => [...prev, { id, address: addr, size }]);
    }
  }, [onAddWatchpoint, wpAddr, wpSize]);

  const doRemoveWatchpoint = useCallback(async (id: number) => {
    if (!onRemoveWatchpoint) return;
    const ok = await onRemoveWatchpoint(id);
    if (ok) {
      setWatchpoints((prev) => prev.filter((wp) => wp.id !== id));
    }
  }, [onRemoveWatchpoint]);

  const doGdbSend = useCallback(async () => {
    if (!onGdbPacket || !gdbCmd.trim()) return;
    setGdbBusy(true);
    try {
      const resp = await onGdbPacket(gdbCmd.trim());
      setGdbResp(resp);
    } finally {
      setGdbBusy(false);
    }
  }, [onGdbPacket, gdbCmd]);
  // The frame is the program the person is looking at; the prop only speaks
  // for a run that has not stopped yet.
  const compiledRun = frame !== null ? frame.compiled === true : compiled;
  const spValue = frame?.registers?.find((register) => register.name === 'SP')?.value;
  const sp = spValue === undefined ? undefined : Number.parseInt(spValue, 16);
  return (
    <section className="flex h-full flex-col gap-2 px-3 py-2">
      {frame === null ? (
        <>
          <p className="font-sans text-xs text-[var(--hd-muted)]">
            {watchable
              ? 'The program is running. Set a stop in the margin and it will stop there.'
              : 'This run is on a core the debugger cannot read. Stop it on the interpreted sketch.'}
          </p>
          {watchable && compiledRun && (
            <p className="font-sans text-xs text-[var(--hd-faint)]">
              Compiled AVR firmware: stops come from the build&apos;s source lines; a stop shows
              sketch variables, the register file and SRAM.
            </p>
          )}
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-[var(--hd-text)]">
              {frame.file}:{frame.line}
            </span>
            {frame.pc !== undefined && (
              <span className="num font-mono text-[11px] text-[var(--hd-faint)]">
                PC 0x{frame.pc.toString(16).padStart(4, '0')}
              </span>
            )}
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
          {compiledRun && (
            <p className="font-sans text-xs text-[var(--hd-faint)]">
              Compiled AVR firmware: variables and memory come from the build&apos;s DWARF. With
              -Os, a name whose value is no longer live is shown as optimized out.
            </p>
          )}
          {frame.variables.length > 0 && (
            <table className="w-full font-mono text-xs">
              <tbody>
                {frame.variables.map((variable) => (
                  <tr key={`${variable.scope}:${variable.name}:${variable.declLine ?? 0}`}>
                    <td className="w-16 py-0.5 pr-2 text-[var(--hd-faint)]">{variable.scope}</td>
                    <td className="py-0.5 pr-2 text-[var(--hd-text)]">{variable.name}</td>
                    <td className="py-0.5 text-[var(--hd-muted)]">{variable.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {frame.registers !== undefined && frame.registers.length > 0 && (
            <div>
              <p className="mb-1 font-sans text-[11px] tracking-[0.08em] uppercase text-[var(--hd-faint)]">
                Registers
              </p>
              <dl className="num grid grid-cols-3 gap-x-3 gap-y-0.5 font-mono text-[11px]">
                {frame.registers.map((register) => (
                  <div key={register.name} className="flex justify-between gap-1">
                    <dt className="text-[var(--hd-faint)]">{register.name}</dt>
                    <dd className="text-[var(--hd-text)]">{register.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {frame.memory !== undefined && (
            <details className="rounded border border-[var(--hd-border)]">
              <summary className="cursor-pointer px-2 py-1 font-sans text-[11px] tracking-[0.08em] uppercase text-[var(--hd-faint)]">
                Memory
              </summary>
              <div className="max-h-48 overflow-auto">
                <table className="w-full font-mono text-[11px]">
                  <tbody>
                    {memoryRows(frame.memory, sp).map((row) => (
                      <tr
                        key={row.address}
                        className={row.hasSp ? 'bg-[var(--hd-border)]/40' : undefined}
                      >
                        <td className="py-0.5 pr-2 text-[var(--hd-faint)]">
                          {row.hasSp ? '>' : ' '}0x{row.address.toString(16).padStart(4, '0')}
                        </td>
                        <td className="py-0.5 pr-2 text-[var(--hd-text)]">{row.hex}</td>
                        <td className="py-0.5 text-[var(--hd-muted)]">{row.ascii}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {compiledRun && onReadMemory && (
            <details className="rounded border border-[var(--hd-border)]">
              <summary className="cursor-pointer px-2 py-1 font-sans text-[11px] tracking-[0.08em] uppercase text-[var(--hd-faint)]">
                Memory read
              </summary>
              <div className="flex items-center gap-2 px-2 py-1">
                <input
                  className="w-24 rounded border border-[var(--hd-border)] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[var(--hd-text)]"
                  value={readAddr}
                  onChange={(e) => setReadAddr(e.target.value)}
                  placeholder="0x100"
                />
                <Button size="sm" variant="secondary" onClick={doReadMemory} disabled={readBusy}>
                  {readBusy ? 'Reading...' : 'Read 16'}
                </Button>
              </div>
              {readResult !== null && (
                <div className="px-2 pb-1 font-mono text-[11px] text-[var(--hd-text)]">
                  {readResult.map((b) => b.toString(16).padStart(2, '0')).join(' ')}
                </div>
              )}
            </details>
          )}
          {compiledRun && onAddWatchpoint && (
            <details className="rounded border border-[var(--hd-border)]">
              <summary className="cursor-pointer px-2 py-1 font-sans text-[11px] tracking-[0.08em] uppercase text-[var(--hd-faint)]">
                Watchpoints
              </summary>
              <div className="flex items-center gap-2 px-2 py-1">
                <input
                  className="w-24 rounded border border-[var(--hd-border)] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[var(--hd-text)]"
                  value={wpAddr}
                  onChange={(e) => setWpAddr(e.target.value)}
                  placeholder="0x100"
                />
                <input
                  className="w-12 rounded border border-[var(--hd-border)] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[var(--hd-text)]"
                  value={wpSize}
                  onChange={(e) => setWpSize(e.target.value)}
                  placeholder="1"
                />
                <Button size="sm" variant="secondary" onClick={doAddWatchpoint}>
                  Add
                </Button>
              </div>
              {watchpoints.length > 0 && (
                <ul className="px-2 pb-1 font-mono text-[11px] text-[var(--hd-text)]">
                  {watchpoints.map((wp) => (
                    <li key={wp.id} className="flex items-center gap-2">
                      <span>
                        0x{wp.address.toString(16).padStart(4, '0')} ({wp.size} byte{wp.size === 1 ? '' : 's'})
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => doRemoveWatchpoint(wp.id)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
          {compiledRun && onGdbPacket && (
            <details className="rounded border border-[var(--hd-border)]">
              <summary className="cursor-pointer px-2 py-1 font-sans text-[11px] tracking-[0.08em] uppercase text-[var(--hd-faint)]">
                GDB
              </summary>
              <div className="flex items-center gap-2 px-2 py-1">
                <input
                  className="flex-1 rounded border border-[var(--hd-border)] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[var(--hd-text)]"
                  value={gdbCmd}
                  onChange={(e) => setGdbCmd(e.target.value)}
                  placeholder="? g m0,4 c s"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doGdbSend();
                  }}
                />
                <Button size="sm" variant="secondary" onClick={doGdbSend} disabled={gdbBusy}>
                  {gdbBusy ? '...' : 'Send'}
                </Button>
              </div>
              {gdbResp !== '' && (
                <div className="px-2 pb-1 font-mono text-[11px] text-[var(--hd-text)] break-all">
                  {gdbResp}
                </div>
              )}
            </details>
          )}
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
