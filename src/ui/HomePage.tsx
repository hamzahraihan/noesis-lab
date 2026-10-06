/**
 * The home page: choose a board before the bench.
 *
 * The bench is a tool for people who already know which microcontroller they
 * are holding, and it has no opinion about that choice -- the board dropdown in
 * its header swaps one board for another mid-session. A learner arriving cold has
 * no such opinion, so the first question is put first, and the bench opens with
 * the answer already made.
 *
 * Every number on a card is read off the board's own definition by `boardSpecs`,
 * so what the card promises is what the simulation will do. The only prose here
 * is editorial: what a board is, and who should reach for it.
 */

import {
  ArrowRightIcon,
  LightningBoltIcon,
  MixerHorizontalIcon,
  ReaderIcon,
} from '@radix-ui/react-icons';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { BOARDS, boardSpecs, DEFAULT_BOARD_ID, type BoardOption } from './boardRegistry';
import { PartPreview } from './PartPreview';

/** A spec chip: a label and the value it describes, in the board's own units. */
function Chip({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md bg-slate-800 px-2 py-1 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-200 tabular-nums">{value}</span>
    </span>
  );
}

/**
 * The board itself, drawn by the very renderer the bench uses.
 *
 * A card that lists pin counts asks the reader to picture the board from a name
 * and a number. Showing it means the choice is made against the actual outline
 * -- a Mega is twice the width of an Uno, an ESP32 is a narrow stick -- and it
 * is the same artwork at the same millimetre size the bench opens on, so the
 * picture cannot drift from the board that gets built.
 */
function BoardArt({ board, className }: { readonly board: BoardOption; readonly className: string }) {
  // Every board's `make()` builds a fresh definition; memoised on the entry
  // itself, which is a module-level constant and so stable across renders.
  const definition = useMemo(() => board.make(), [board]);
  return <PartPreview definition={definition} className={className} />;
}

export function HomePage() {

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <header className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Noesis Lab</h1>
          <p className="mt-2 text-slate-400">
            A workbench for learning embedded systems: wire a circuit on a real
            board's footprint, write the firmware that drives it, and watch the
            voltage move while it runs.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            Pick a board to start on. Every bench has its own address, so one can
            be bookmarked or sent to someone else.
          </p>
        </header>

        {/*
         * Learn, before the board list rather than after it.
         *
         * A beginner's real question on this page is not "which board" but
         * "what do I do". Nine guided exercises and a glossary answer that, and
         * burying them under six board cards would make the track look like an
         * afterthought rather than the reason any of the boards are here.
         */}
        <Link
          to="/learn"
          className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-600 hover:bg-slate-900"
        >
          <span>
            <span className="block font-medium text-slate-100">
              Learn embedded systems
            </span>
            <span className="mt-1 block text-sm text-slate-400">
              Nine guided exercises from your first LED to interrupts — wiring, code,
              hints and references, all runnable on the simulator.
            </span>
          </span>
          <ArrowRightIcon
            className="icon shrink-0 text-sky-400"
            aria-hidden="true"
          />
        </Link>

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BOARDS.map((board) => {
            const specs = boardSpecs(board.id);

            return (
              <li key={board.id}>
                {/*
                 * A link rather than a button: the card points somewhere, so it
                 * deserves a real href. That is what makes a bench openable in a
                 * new tab, copyable as a link, and bookmarkable -- all of which a
                 * click handler would have had to reimplement badly.
                 */}
                <Link
                  to={`/bench/${board.id}`}
                  className="group flex h-full w-full flex-col items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left transition-colors hover:border-slate-600 hover:bg-slate-900"
                >
                  {/*
                   * The board, drawn by the bench's own renderer at its own
                   * size. Bleeding to the card edges and letterboxed to a fixed
                   * height, so a long Mega and a narrow ESP32 line up as a row
                   * rather than giving each card its own idea of how tall a
                   * board is.
                   */}
                  <span className="-m-4 mb-3 flex h-36 items-center justify-center border-b border-slate-800 bg-slate-950/60 p-3">
                    <BoardArt board={board} className="h-full w-full" />
                  </span>
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="font-medium text-slate-100">{board.name}</span>
                    {board.id === DEFAULT_BOARD_ID && (
                      <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-400">
                        Start here
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-slate-300">{board.summary}</span>

                  {/*
                   * The electrical facts, derived from the board's own pin table.
                   * A card cannot advertise a resolution the simulator does not
                   * have, because these numbers come from the same definition the
                   * bench is built from.
                   */}
                  <span className="flex flex-wrap gap-1.5">
                    <Chip label="logic" value={`${specs.logicVolts} V`} />
                    {/*
                     * A board with no converter says so rather than showing a
                     * resolution of zero. That absence is the reason to reach
                     * for an MCP3008, so it belongs on the card.
                     */}
                    {specs.adcCount > 0 ? (
                      <Chip label="ADC" value={`${specs.adcBits}-bit`} />
                    ) : (
                      <Chip label="ADC" value="none" />
                    )}
                    <Chip label="GPIO" value={String(specs.gpioCount)} />
                    <Chip label="analogue" value={String(specs.adcCount)} />
                    <Chip label="PWM" value={`${specs.pwmHz} Hz`} />
                    {specs.inputOnlyCount > 0 && (
                      <Chip
                        label="input-only"
                        value={String(specs.inputOnlyCount)}
                      />
                    )}
                  </span>

                  <span className="text-xs leading-relaxed text-slate-500">
                    {board.bestFor}
                  </span>

                  <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-sky-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    Open the bench
                    <ArrowRightIcon className="icon-sm" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/*
         * What the bench does, stated before the learner has touched it -- the
         * three things a simulated board can do that a diagram cannot.
         */}
        <section className="mt-12 border-t border-slate-800 pt-8">
          <h2 className="text-sm font-semibold tracking-tight text-slate-200">
            What you get on the bench
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <LightningBoltIcon className="icon text-sky-400" aria-hidden="true" />
                A circuit that solves
              </dt>
              <dd className="mt-1 text-sm text-slate-500">
                Every part is solved as a resistive network each frame. Change a
                resistor and the current changes with it, exactly as it would on
                the bench.
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <MixerHorizontalIcon className="icon text-sky-400" aria-hidden="true" />
                Instruments, not just parts
              </dt>
              <dd className="mt-1 text-sm text-slate-500">
                Multimeter, scope, logic analyser, bus monitor and a serial
                terminal -- so a sketch can be checked against what the wires
                actually carry.
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <ReaderIcon className="icon text-sky-400" aria-hidden="true" />
                Firmware that runs
              </dt>
              <dd className="mt-1 text-sm text-slate-500">
                Arduino sketches with <code className="text-slate-400">millis()</code>,
                the I²C and SPI libraries, and interrupts where the board has
                them.
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
