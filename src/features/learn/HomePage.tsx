/**
 * The home page: a herdr.dev-inspired landing for the bench.
 *
 * Herdr's page is the reference for the composition: a terminal-dark ground,
 * one heavy display face, a command line instead of a marketing hero, a stats
 * strip, an interactive product mock, and numbered capability rows. The content
 * is Noesis's own: real boards, real exercises, real instruments, and the
 * truth-in-simulation promise. Nothing here is invented; every number is a
 * count of something the simulator actually ships.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Navbar, AnnouncementStrip, SkipLink } from '@/components';

import { BOARDS, boardSpecs, DEFAULT_BOARD_ID, type BoardOption } from './boardRegistry';
import { PartPreview } from '@/features/bench';

export function BoardArt({ board, className }: { readonly board: BoardOption; readonly className: string }) {
  const definition = useMemo(() => board.make(), [board]);
  return <PartPreview definition={definition} className={className} />;
}

const FEATURED = 'uno';

export function HomePage() {
  const featuredBoard = BOARDS.find((board) => board.id === DEFAULT_BOARD_ID) ?? BOARDS[0];
  const [selectedBoardId, setSelectedBoardId] = useState(featuredBoard.id);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'layout' | 'code' | 'serial'>('code');
  const copyCommand = () => {
    try { navigator.clipboard?.writeText(`noesis open ${FEATURED}`); } catch { /* ignore */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const selectedBoard = BOARDS.find((board) => board.id === selectedBoardId) ?? featuredBoard;
  const selectedSpecs = boardSpecs(selectedBoard.id);
  const boardCount = BOARDS.length;
  const exerciseCount = 11;
  const instrumentCount = 5;

  return (
    <div className="min-h-full bg-[var(--hd-bg)] text-[var(--hd-text)] antialiased hd-grid">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=JetBrains+Mono:wght@400;500&display=swap"
      />

      <SkipLink />

      <div className="mx-auto min-h-screen max-w-6xl border-x border-[var(--hd-border)]">
        <Navbar defaultBoardId={DEFAULT_BOARD_ID} />
        <AnnouncementStrip />

        <main id="main" tabIndex={-1}>
          {/* Hero */}
      <header className="relative mx-auto max-w-6xl overflow-hidden px-6 pt-10 pb-12">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-[-2rem] top-8 hidden h-64 w-64 opacity-[0.06] lg:block"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          style={{ color: 'var(--hd-text)' }}
        >
          <path d="M10 30 H60 V80 H120 V40 H190" />
          <path d="M10 100 H90 V160 H170 V120 H190" />
          <path d="M30 10 V190" />
          <circle cx="60" cy="80" r="3" fill="currentColor" />
          <circle cx="120" cy="40" r="3" fill="currentColor" />
          <circle cx="90" cy="160" r="3" fill="currentColor" />
        </svg>
        <div className="mb-6 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--hd-muted)]">
          <span className="h-px w-8 bg-[var(--hd-accent)]" aria-hidden="true" />
          the embedded workbench
        </div>
        <h1 className="font-['Archivo'] text-[clamp(2.5rem,8vw,6rem)] font-black leading-[0.95] tracking-tight text-[var(--hd-text)]">
          Wire it. <em className="not-italic text-[var(--hd-accent)]">Run it.</em> Watch it move.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--hd-muted)]">
          Noesis is where your circuits live. Wire a board on a real footprint,
          write the firmware that drives it, and watch the voltage move while it
          runs. <b className="font-semibold text-[var(--hd-text)]">Close the tab and the
          bench is still there at its own address â€” reopen it and pick up where
          you left off.</b>
        </p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] px-4 py-2.5 font-['JetBrains_Mono'] text-sm text-[var(--hd-text)]">
            <span className="text-[var(--hd-accent)]">$</span>
            <span>noesis open {FEATURED}</span>
            <button
              type="button"
              onClick={copyCommand}
              className="ml-2 border-l border-[var(--hd-border)] pl-2 text-xs text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
              aria-label="Copy command"
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
          <Link
            to="/learn"
            className="text-sm font-medium text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
          >
            New here? Start with the guided exercises â†’
          </Link>
        </div>
        <div className="mt-6 text-xs text-[var(--hd-faint)]">
          {boardCount} boards · {exerciseCount} exercises · {instrumentCount} instruments &nbsp;â€”&nbsp;{' '}
          <a href="/learn/references" className="transition-colors hover:text-[var(--hd-muted)]">
            references and glossary â†’
          </a>
        </div>
      </header>

      {/* Stats strip */}
      <div className="border-y border-[var(--hd-border)] bg-[var(--hd-surface)]/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-[var(--hd-border)] px-6 py-0 md:grid-cols-4">
          {[
            { n: String(boardCount), label: 'boards supported' },
            { n: String(exerciseCount), label: 'guided exercises' },
            { n: String(instrumentCount), label: 'bench instruments' },
            { n: '2.54mm', label: 'true part pitch' },
          ].map((stat) => (
            <div key={stat.label} className="bg-[var(--hd-surface)] px-5 py-6">
              <div className="font-['Archivo'] text-3xl font-black tracking-tight text-[var(--hd-text)]">
                {stat.n}
              </div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--hd-muted)]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Product mock */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-6 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--hd-muted)]">
          <span>the bench, from a tab that isn't there</span>
          <span>click a board</span>
        </div>
        <figure className="overflow-hidden rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg-deep)]">
          <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[220px_1fr]">
            <aside className="border-b border-[var(--hd-border)] bg-[var(--hd-surface-alt)] p-4 md:border-b-0 md:border-r">
              <div className="mb-3 text-xs uppercase tracking-[0.2em] text-[var(--hd-faint)]">
                boards
              </div>
              <ul className="space-y-1 text-sm">
                {BOARDS.slice(0, 6).map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedBoardId(board.id)}
                      className={
                        board.id === selectedBoard.id
                          ? 'flex w-full items-center gap-2 rounded-none bg-[var(--hd-border)] px-2 py-1.5 text-left text-[var(--hd-text)] transition-colors hover:bg-[var(--hd-border-strong)]'
                          : 'flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-[var(--hd-muted)] transition-colors hover:bg-[var(--hd-border)] hover:text-[var(--hd-text)]'
                      }
                    >
                      <span
                        className={
                          board.id === selectedBoard.id
                            ? 'inline-block h-1.5 w-1.5 bg-[var(--hd-accent)]'
                            : 'inline-block h-1.5 w-1.5 bg-[var(--hd-faint)]'
                        }
                        aria-hidden="true"
                      />
                      {board.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-6 mb-3 text-xs uppercase tracking-[0.2em] text-[var(--hd-faint)]">
                instruments
              </div>
              <ul className="space-y-1 text-xs text-[var(--hd-muted)]">
                <li>multimeter</li>
                <li>oscilloscope</li>
                <li>logic analyser</li>
                <li>bus monitor</li>
                <li>serial terminal</li>
              </ul>
            </aside>
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-3 border-b border-[var(--hd-border)] pb-3">
                <span className="font-['JetBrains_Mono'] text-xs text-[var(--hd-muted)]">
                  ~/bench/{selectedBoard.id}
                </span>
                <span className="ml-auto text-xs text-[var(--hd-faint)]">
                  {selectedSpecs.logicVolts}V · {selectedSpecs.adcBits}-bit ADC · {selectedSpecs.gpioCount} GPIO
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.1fr_1fr]">
                <div
                  aria-hidden="true"
                  className="flex h-44 items-center justify-center rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg-deep)] p-3"
                >
                  <BoardArt board={selectedBoard} className="h-full w-full" />
                </div>
                <div className="rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg-deep)] font-['JetBrains_Mono'] text-xs leading-relaxed">
                  <div className="flex border-b border-[var(--hd-border)]">
                    {(['layout', 'code', 'serial'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveTab(t)}
                        className={
                          activeTab === t
                            ? 'border-r border-[var(--hd-border)] bg-[var(--hd-border)] px-3 py-1.5 text-[var(--hd-text)]'
                            : 'border-r border-[var(--hd-border)] px-3 py-1.5 text-[var(--hd-faint)] transition-colors hover:text-[var(--hd-muted)]'
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="p-3">
                    {activeTab === 'code' && (
                      <>
                        <div className="text-[var(--hd-faint)]">// blink.ino</div>
                  <div className="text-[var(--hd-text)]">void setup() {'{'}</div>
                  <div className="pl-4 text-[var(--hd-text)]">pinMode(13, OUTPUT);</div>
                  <div className="text-[var(--hd-text)]">{'}'}</div>
                  <div className="mt-2 text-[var(--hd-text)]">void loop() {'{'}</div>
                  <div className="pl-4 text-[var(--hd-text)]">digitalWrite(13, HIGH);</div>
                  <div className="pl-4 text-[var(--hd-text)]">delay(500);</div>
                  <div className="pl-4 text-[var(--hd-text)]">digitalWrite(13, LOW);</div>
                  <div className="pl-4 text-[var(--hd-text)]">delay(500);</div>
                  <div className="text-[var(--hd-text)]">{'}'}</div>
                  <div className="mt-3 border-t border-[var(--hd-border)] pt-2 text-[var(--hd-success)]">
                    serial: LED on pin 13 toggling @ 1 Hz
                  </div>
                      </>
                    )}
                    {activeTab === 'serial' && (
                      <div className="text-[var(--hd-success)]">
                        serial: LED on pin 13 toggling @ 1 Hz
                        <div className="mt-2 text-[var(--hd-faint)]">baud 9600 · 8N1 · no flow control</div>
                      </div>
                    )}
                    {activeTab === 'layout' && (
                      <div className="text-[var(--hd-muted)]">
                        board: {selectedBoard.name}
                        <div className="mt-2 text-[var(--hd-faint)]">
                          {selectedSpecs.logicVolts}V · {selectedSpecs.adcBits}-bit ADC · {selectedSpecs.gpioCount} GPIO
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-3 border-t border-[var(--hd-border)] pt-3">
                <Link
                  to={`/projects/${selectedBoard.id}`}
                  className="rounded-none bg-[var(--hd-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--hd-bg)] transition-colors hover:bg-[var(--hd-accent-hover)]"
                >
                  Open this bench
                </Link>
                <span className="text-xs text-[var(--hd-faint)]">
                  {selectedBoard.bestFor}
                </span>
              </div>
            </div>
          </div>
          <figcaption className="border-t border-[var(--hd-border)] px-5 py-3 text-xs text-[var(--hd-muted)]">
            The whole bench in one tab. Click a board, it is a real layout.
          </figcaption>
        </figure>
      </section>

      {/* Numbered capabilities */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 gap-px border border-[var(--hd-border)] bg-[var(--hd-border)]">
          {[
            {
              n: '01',
              title: 'Always solving.',
              body: 'Every part is solved as a resistive network each frame. Change a resistor and the current changes with it, exactly as it would on the bench.',
              ev: 'R1 10kÎ© · I 0.42mA',
            },
            {
              n: '02',
              title: 'You never hunt for the stuck pin.',
              body: 'Pin-level voltage and current readouts, so a floating input or a missing pull-up is something you see, not something you guess.',
              ev: 'pin 13 · 4.87V · 0mA',
            },
            {
              n: '03',
              title: 'Firmware that runs.',
              body: 'Arduino sketches with millis(), the IÂ²C and SPI libraries, and interrupts where the board has them â€” against the simulated hardware.',
              ev: 'Wire.begin() · 0x3C ok',
            },
            {
              n: '04',
              title: 'Runs what you already know.',
              body: `${boardCount} real boards, each with its own pin numbering and buses. The card promises what the simulator will do, because the numbers come from the board's own definition.`,
              ev: 'Uno · ESP32 · Mega · RP2040',
            },
            {
              n: '05',
              title: 'One bench, one address.',
              body: 'Every bench has its own URL. Bookmark it, send it to a student, or reopen it tomorrow â€” the wiring and the code are where you left them.',
              ev: 'noesis.app/#/bench/uno',
            },
          ].map((cap) => (
            <a
              key={cap.n}
              href="#"
              className="group grid grid-cols-[auto_1fr_auto] items-start gap-6 bg-[var(--hd-bg)] p-6 transition-colors hover:bg-[var(--hd-surface)]"
            >
              <div className="font-['JetBrains_Mono'] text-xs text-[var(--hd-faint)]">{cap.n}</div>
              <div>
                <h3 className="font-['Archivo'] text-xl font-bold tracking-tight text-[var(--hd-text)]">
                  {cap.title} <span className="text-[var(--hd-accent)]">â†’</span>
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--hd-muted)]">
                  {cap.body}
                </p>
              </div>
              <div className="hidden font-['JetBrains_Mono'] text-xs text-[var(--hd-faint)] md:block">
                {cap.ev}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* End CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16" id="open">
        <div className="rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] p-8 md:p-12">
          <h2 className="font-['Archivo'] text-3xl font-black tracking-tight text-[var(--hd-text)] md:text-5xl">
            Give your circuit somewhere to live.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--hd-muted)]">
            One click, and nothing else about your setup changes â€” the boards you
            already know keep working exactly as they do, except now there is no
            risk of a burnt LED.
          </p>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link
              to={`/projects/${DEFAULT_BOARD_ID}`}
              className="rounded-none bg-[var(--hd-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--hd-bg)] transition-colors hover:bg-[var(--hd-accent-hover)]"
            >
              Open the Uno bench
            </Link>
            <Link
              to="/learn"
              className="text-sm font-medium text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
            >
              or start with exercise 0.1 â†’
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--hd-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-xs text-[var(--hd-faint)] md:flex-row md:items-center">
          <span className="font-['Archivo'] font-bold text-[var(--hd-muted)]">noesis</span>
          <a href="/learn" className="transition-colors hover:text-[var(--hd-muted)]">learn</a>
          <a href="/boards" className="transition-colors hover:text-[var(--hd-muted)]">boards</a>
          <a href="/learn/references" className="transition-colors hover:text-[var(--hd-muted)]">references</a>
          <a href="/diagnostics" className="transition-colors hover:text-[var(--hd-muted)]">diagnostics</a>
          <span className="md:ml-auto">built in the browser · v0.0.0 · Apache 2.0</span>
        </div>
      </footer>
        </main>
      </div>
    </div>
  );
}