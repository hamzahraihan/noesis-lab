/**
 * The Learn section: the curriculum as something you can work through.
 *
 * Two pages, and the split is the one the learner makes. The index answers
 * "where do I start"; the exercise answers "what do I do now". Between them
 * they carry the parts of a worksheet that a browser is better at than paper --
 * the wiring table rendered from the same data the bench is built from, hints
 * the learner reveals only when they are stuck, and references with the
 * vocabulary explained rather than assumed.
 *
 * The prose in `docs/exercises/` stays the authority on *why*. This is the
 * authority on *what to type*, and the two never disagree about a part name
 * because both take it from the catalogue.
 */

import { useState } from 'react';
import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons';
import { Link, useParams } from 'react-router';
import { Button, Navbar, SkipLink } from '@/components';
import { DEFAULT_BOARD_ID } from './boardRegistry';
import {
  EXERCISES,
  EXERCISE_BOARD,
  STARTING_LEVEL,
  exerciseBoard,
  exerciseById,
  type Exercise,
} from './exercises';
import { GLOSSARY } from './glossary';
import { ExercisePreview } from './ExercisePreview';

/**
 * The silkscreen names a wiring table may name, for a beginner's sanity check.
 *
 * Colour only, and no worse than that: it marks the cells that name a place
 * on the board so a reader can find them again on the silkscreen. `GPIO\d+` is
 * in there for the single-board-computer lessons, whose header is numbered BCM
 * and whose pins carry no other name at all.
 */
function isBoardPin(name: string): boolean {
  return /^(D\d{1,2}|A\d|TX|RX|GPIO\d{1,2}|\dV3?|GND|AREF|RESET|IOREF)$/.test(name);
}

/**
 * The index: every exercise, grouped by the level it belongs to.
 *
 * Levels, not a flat list, because the whole point of the ladder is that the
 * order carries meaning: 1.2's sub-second state machine is the pattern 4.2's
 * ping-pong loop needs. A flat list of nine would throw that away.
 */
export function ExercisesPage() {
  const levels = [...new Set(EXERCISES.map((exercise) => exercise.level))].sort();

  return (
    <div className="min-h-screen bg-[var(--hd-bg)] text-[var(--hd-text)] antialiased hd-grid font-['Noto_Sans']">
      <SkipLink />
      <div className="mx-auto min-h-screen max-w-7xl border-x border-[var(--hd-border)] bg-[var(--hd-bg)]">
        <Navbar defaultBoardId={DEFAULT_BOARD_ID} />

        <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-10">
          <h2 className="font-['Archivo'] text-2xl font-black tracking-tight text-balance text-[var(--hd-text)]">
            Embedded systems, from a pin you can switch
          </h2>
          <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">
            Nine exercises in five levels, written for the Arduino Uno R3. Each one is a circuit you
            build and a program you write; every circuit also runs in the simulator, so you can do
            the whole track without hardware on the desk. Start at level 1 unless you already know
            what a pull-up is.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={`/bench/${EXERCISE_BOARD}`}>Open the bench</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/learn/references">Reference &amp; glossary</Link>
            </Button>
          </div>

          {levels.map((level) => (
            <section key={level} className="mt-12">
              <div className="flex items-baseline gap-3 border-b border-[var(--hd-border)] pb-2.5">
                <h3 className="text-sm font-semibold tracking-tight text-[var(--hd-text)]">
                  Level {level}
                </h3>
                <span className="text-xs text-[var(--hd-muted)]">
                  {level === STARTING_LEVEL ? 'start here' : `needs level ${level - 1}`}
                </span>
              </div>

              <ul className="mt-4 space-y-2.5">
                {EXERCISES.filter((exercise) => exercise.level === level).map((exercise) => (
                  <li key={exercise.id}>
                    <Link
                      to={`/learn/${exercise.id}`}
                      className="group block overflow-hidden rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)]/60 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)] transition-all duration-150 ease-out hover:-translate-y-px hover:border-[var(--hd-border-strong)] hover:bg-[var(--hd-surface)] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                    >
                      {/*
                       * The destination, up front: the finished wiring each
                       * exercise builds toward, drawn by the bench's own
                       * renderer rather than described.
                       */}
                      <span className="block h-28 border-b border-[var(--hd-border)] bg-[var(--hd-bg)]">
                        <ExercisePreview
                          exercise={exercise}
                          fit="slice"
                          className="h-full w-full"
                        />
                      </span>
                      <span className="block px-4 py-3.5">
                        <div className="flex items-baseline gap-3">
                          <span className="num font-mono text-xs text-[var(--hd-accent)]/90">
                            {exercise.id}
                          </span>
                          <span className="font-medium tracking-tight text-[var(--hd-text)]">
                            {exercise.title}
                          </span>
                          <span className="num ml-auto shrink-0 text-xs text-[var(--hd-faint)]">
                            {exercise.minutes}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">
                          {exercise.brief}
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          <span className="rounded-none bg-[var(--hd-border)] px-1.5 py-0.5 text-xs font-medium text-[var(--hd-text)]">
                            {exercise.difficulty}
                          </span>
                          {exercise.concepts.slice(0, 2).map((concept) => (
                            <span
                              key={concept}
                              className="rounded-none bg-[var(--hd-border)]/70 px-1.5 py-0.5 text-xs text-[var(--hd-faint)]"
                            >
                              {concept}
                            </span>
                          ))}
                        </div>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}

/**
 * One exercise, worked through.
 *
 * The hints are the point of this page. A worksheet that prints the answer
 * teaches by transcription; one that prints the symptom and nothing else teaches
 * by guessing, which is slower and is the actual skill. So each hint is behind
 * a click, in the order that helps least-harm-first, and stays open once opened.
 */
export function ExercisePage() {
  const { id } = useParams();
  const exercise = id === undefined ? null : exerciseById(id);
  const [revealed, setRevealed] = useState(0);

  if (exercise === null) {
    return (
      <ExerciseShell title="No such exercise">
        <p className="text-sm text-[var(--hd-muted)]">
          There is no exercise {id}.{' '}
          <Link to="/learn" className="text-[var(--hd-accent)] underline">
            Back to the list
          </Link>
          .
        </p>
      </ExerciseShell>
    );
  }

  return (
    <ExerciseShell title={exercise.title} crumb={exercise.id}>
      <p className="text-xs text-[var(--hd-muted)]">
        {exercise.module} · {exercise.difficulty} · {exercise.minutes}
      </p>
      <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-[var(--hd-text)]">
        {exercise.brief}
      </p>

      <FinishedBuild exercise={exercise} />

      <Concepts exercise={exercise} />
      <PartsTable exercise={exercise} />
      <WiringTable exercise={exercise} />
      <Steps exercise={exercise} />
      <SketchPanel exercise={exercise} />
      {exercise.fault !== undefined && <FaultPanel exercise={exercise} />}
      <Hints exercise={exercise} revealed={revealed} setRevealed={setRevealed} />
      <SolutionPanel exercise={exercise} />
      <References exercise={exercise} />

      <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-[var(--hd-border)] pt-6">
        <Button asChild size="sm">
          <Link to={`/bench/${exerciseBoard(exercise)}?ex=${exercise.id}`}>
            Put it on the bench
          </Link>
        </Button>
        <span className="text-xs text-[var(--hd-faint)]">
          Opens the bench with wiring + code, and the guide walks you through it.
        </span>
        <span className="flex-1" />
        <Button asChild variant="outline" size="sm">
          <Link to="/learn/references">Reference &amp; glossary</Link>
        </Button>
      </div>
    </ExerciseShell>
  );
}

function ExerciseShell({
  title,
  crumb,
  children,
}: {
  title: string;
  crumb?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--hd-bg)] text-[var(--hd-text)] antialiased hd-grid font-['Noto_Sans']">
      <SkipLink />
      <div className="mx-auto min-h-screen max-w-7xl border-x border-[var(--hd-border)] bg-[var(--hd-bg)]">
        <Navbar defaultBoardId={DEFAULT_BOARD_ID} />
        <div className="mx-auto max-w-3xl px-6 py-3 text-xs text-[var(--hd-faint)]">
          <Link to="/learn" className="transition-colors hover:text-[var(--hd-muted)]">
            Learn
          </Link>
          {crumb !== undefined && (
            <>
              <span className="mx-2">/</span>
              <span className="font-mono">{crumb}</span>
            </>
          )}
        </div>
        <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="font-['Archivo'] text-2xl font-black tracking-tight text-balance text-[var(--hd-text)]">
            {title}
          </h1>
          <div className="mt-8 space-y-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** A titled block, so every section on the page reads as the same object. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-[var(--hd-border)] pb-2.5 text-sm font-semibold tracking-tight text-[var(--hd-text)]">
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/**
 * The destination, before the work: the finished wiring this exercise builds
 * toward, drawn by the bench's own renderer, plus what "working" looks like
 * once it is running. A learner who can picture the end state reads every
 * step that follows as getting closer to it.
 */
function FinishedBuild({ exercise }: { exercise: Exercise }) {
  const working = exercise.solution?.working;
  return (
    <figure>
      <div className="overflow-hidden rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg)] shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)]">
        <ExercisePreview exercise={exercise} className="h-64 w-full" />
      </div>
      <figcaption className="mt-2 text-xs leading-relaxed text-[var(--hd-faint)]">
        The finished wiring, exactly as the bench loads it — unpowered here, so nothing is lit. Put
        it on the bench and press Run to see it live.
      </figcaption>
      {working !== undefined && working.length > 0 && (
        <div className="mt-4 rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)]/60 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-[var(--hd-text)]">
            <CheckIcon className="icon-sm text-[var(--hd-success)]" aria-hidden="true" />
            When it is working
          </h3>
          <ul className="mt-2 space-y-1.5">
            {working.map((sign) => (
              <li
                key={sign}
                className="flex gap-2.5 text-sm leading-relaxed text-[var(--hd-muted)]"
              >
                <CheckIcon
                  className="icon-sm mt-0.5 shrink-0 text-[var(--hd-success)]"
                  aria-hidden="true"
                />
                <span>{sign}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}

function Concepts({ exercise }: { exercise: Exercise }) {
  return (
    <Section title="What this is the first time you meet">
      <ul className="space-y-1.5">
        {exercise.concepts.map((concept) => (
          <li key={concept} className="flex gap-2 text-sm leading-relaxed text-[var(--hd-muted)]">
            <span className="text-[var(--hd-accent)]">·</span>
            {concept}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PartsTable({ exercise }: { exercise: Exercise }) {
  return (
    <Section title="What you need">
      <table className="w-full text-sm">
        <tbody>
          {exercise.parts.map((entry) => (
            <tr key={entry.name} className="border-b border-[var(--hd-border)]/60 last:border-0">
              <td className="w-8 py-1.5 text-right font-mono text-xs text-[var(--hd-faint)]">
                {entry.qty}×
              </td>
              <td className="w-48 py-1.5 pr-4 text-[var(--hd-text)]">{entry.name}</td>
              <td className="py-1.5 text-[var(--hd-muted)]">{entry.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[var(--hd-faint)]">
        Part names are the simulator's own, so what you read here is exactly what you will find in
        the Components list. A 10 kΩ resistor is listed as <code>10k Resistor</code>.
      </p>
    </Section>
  );
}

function WiringTable({ exercise }: { exercise: Exercise }) {
  return (
    <Section title="Wiring">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-[var(--hd-faint)]">
            <th className="py-1.5 pr-4 font-normal">Board pin</th>
            <th className="py-1.5 pr-4 font-normal">Part</th>
            <th className="py-1.5 pr-4 font-normal">Terminal</th>
            <th className="py-1.5 font-normal">Connects to</th>
          </tr>
        </thead>
        <tbody>
          {/*
           * Keyed by position, not by content, and the reason is the map
           * exercise: it has three buttons and all three return leg b to GND,
           * so `pin-part-terminal` repeats exactly. A row is only ever
           * identified by where it sits in the table anyway -- the three
           * identical rows are distinct rows precisely because they come
           * from three different buttons.
           */}
          {exercise.wiring.map((row, index) => (
            <tr
              key={`${row.pin}-${row.part}-${row.terminal}-${index}`}
              className="border-t border-[var(--hd-border)]/60"
            >
              <td
                className={`py-1.5 pr-4 font-mono text-xs ${
                  isBoardPin(row.pin) ? 'text-[var(--hd-accent)]' : 'text-[var(--hd-faint)]'
                }`}
              >
                {row.pin}
              </td>
              <td className="py-1.5 pr-4 text-[var(--hd-text)]">{row.part}</td>
              <td className="py-1.5 pr-4 font-mono text-xs text-[var(--hd-muted)]">
                {row.terminal}
              </td>
              <td className="py-1.5 text-[var(--hd-muted)]">{row.goesTo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Steps({ exercise }: { exercise: Exercise }) {
  return (
    <Section title="Build order">
      <ol className="space-y-2">
        {exercise.steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm leading-relaxed text-[var(--hd-muted)]">
            <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-[var(--hd-faint)]">
              {index + 1}.
            </span>
            {step}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function SketchPanel({ exercise }: { exercise: Exercise }) {
  return (
    <Section title="The program">
      <p className="mb-3 max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">
        Press <span className="font-medium text-[var(--hd-text)]">Put it on the bench</span> below:
        it wires the circuit above onto the bench, loads this sketch into the editor, and opens the
        guide that walks you through it. Then press Run.
      </p>
      <pre className="overflow-x-auto rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] p-4 text-xs leading-relaxed text-[var(--hd-text)] shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)]">
        <code>{exercise.sketch}</code>
      </pre>
    </Section>
  );
}

function FaultPanel({ exercise }: { exercise: Exercise }) {
  if (exercise.fault === undefined) return null;
  return (
    <Section title="Break it on purpose">
      <div className="rounded-none border border-[var(--hd-warn)]/30 bg-[var(--hd-warn)]/10 p-4">
        <p className="text-sm font-medium text-[var(--hd-warn)]">{exercise.fault.break_}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--hd-muted)]">
          {exercise.fault.teaches}
        </p>
      </div>
    </Section>
  );
}

function Hints({
  exercise,
  revealed,
  setRevealed,
}: {
  exercise: Exercise;
  revealed: number;
  setRevealed: (count: number) => void;
}) {
  const available = exercise.hints.length;
  return (
    <Section title="Need a nudge?">
      <p className="mb-3 text-sm leading-relaxed text-[var(--hd-muted)]">
        Try it yourself first — the guessing is the skill. If you are stuck, take the next one.
      </p>
      <div className="space-y-2">
        {exercise.hints.slice(0, revealed).map((hint) => (
          <div
            key={hint.when}
            className="rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)]/60 p-4"
          >
            <p className="text-sm font-medium text-[var(--hd-text)]">{hint.when}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--hd-muted)]">{hint.answer}</p>
          </div>
        ))}
      </div>
      {revealed < available && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRevealed(revealed + 1)}
          className="mt-3"
        >
          {revealed === 0 ? 'Show a hint' : `Another hint (${available - revealed} left)`}
        </Button>
      )}
    </Section>
  );
}

/**
 * The worked answer, behind a deliberate click.
 *
 * Placed after the hints rather than beside them because of when it is useful.
 * A worksheet that offers the answer first teaches by transcription; one that
 * never offers it teaches by despair. This is the third thing: try it, take
 * hints if you are stuck, and only then read how someone else did it -- at
 * which point the reasoning is worth more than the answer.
 *
 * It is a disclosure rather than a link because the whole point is that most
 * readers never open it, and a solution that greets every visitor teaches
 * nothing to the ones who get stuck and spoils it for the ones who do not.
 */
function SolutionPanel({ exercise }: { exercise: Exercise }) {
  const solution = exercise.solution;
  const [open, setOpen] = useState(false);

  if (solution === undefined) return null;

  return (
    <Section title="How it goes together">
      {!open ? (
        <>
          <p className="mb-3 text-sm leading-relaxed text-[var(--hd-muted)]">
            The reasoning behind the wiring — why each pin is where it is, and what a finished
            circuit should be doing. Worth reading after you have tried it and read the hints.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Show the worked solution
          </Button>
        </>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--hd-text)]">Where to start</h3>
            <ol className="space-y-2">
              {solution.approach.map((step, index) => (
                <li
                  key={step}
                  className="flex gap-3 text-sm leading-relaxed text-[var(--hd-muted)]"
                >
                  <span className="num shrink-0 text-[var(--hd-faint)]">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--hd-text)]">
              Why each wire is where it is
            </h3>
            <dl className="space-y-3">
              {/*
               * Keyed by position for the same reason as the wiring table: the
               * map exercise explains three identical GND/b jumpers, one per
               * button, and only their order tells them apart.
               */}
              {solution.wiring.map((wire, index) => (
                <div key={`${wire.pin}:${wire.terminal}:${index}`}>
                  <dt className="num text-xs text-[var(--hd-text)]">
                    {wire.pin} → {wire.terminal}
                  </dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-[var(--hd-muted)]">
                    {wire.why}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--hd-text)]">When it is working</h3>
            <ul className="space-y-2">
              {solution.working.map((sign) => (
                <li
                  key={sign}
                  className="flex gap-3 text-sm leading-relaxed text-[var(--hd-muted)]"
                >
                  <CheckIcon
                    className="icon-sm mt-0.5 shrink-0 text-[var(--hd-success)]"
                    aria-hidden="true"
                  />
                  <span>{sign}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--hd-text)]">
              What usually goes wrong
            </h3>
            <ul className="space-y-2">
              {solution.traps.map((trap) => (
                <li
                  key={trap}
                  className="flex gap-3 text-sm leading-relaxed text-[var(--hd-muted)]"
                >
                  <Cross2Icon
                    className="icon-sm mt-0.5 shrink-0 text-amber-500"
                    aria-hidden="true"
                  />
                  <span>{trap}</span>
                </li>
              ))}
            </ul>
          </div>

          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Hide the solution
          </Button>
        </div>
      )}
    </Section>
  );
}

function References({ exercise }: { exercise: Exercise }) {
  return (
    <Section title="References">
      <dl className="space-y-4">
        {exercise.references.map((reference) => (
          <div key={reference.term}>
            <dt className="text-sm font-medium text-[var(--hd-text)]">{reference.term}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-[var(--hd-muted)]">
              {reference.what}{' '}
              {reference.readMore !== undefined && (
                <a
                  href={reference.readMore}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--hd-accent)] underline underline-offset-2"
                >
                  Arduino reference
                </a>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-[var(--hd-faint)]">
        Full write-up: <code>{exercise.writeUp}</code> in the repository. More vocabulary on the{' '}
        <Link
          to="/learn/references"
          className="text-[var(--hd-accent)] underline underline-offset-2"
        >
          reference page
        </Link>
        .
      </p>
    </Section>
  );
}

/**
 * The reference page: the vocabulary a beginner is assumed not to have.
 *
 * Separate from the exercises because it is read out of order, all at once,
 * by someone who does not yet have a question to attach a word to. The exercises
 * explain the terms they are about to use; this is where someone who meets
 * "pull-up" for the first time goes to find out what it is.
 */
export function ReferencesPage() {
  return (
    <ExerciseShell title="Reference & glossary">
      <p className="text-sm leading-relaxed text-[var(--hd-muted)]">
        The words and numbers an embedded course assumes you already know. Nothing here is specific
        to any one exercise — it is the vocabulary the exercises are written in.
      </p>

      <Section title="Reading a board">
        <dl className="space-y-4">
          <Term
            term="VCC / 5V / 3V3"
            what="The positive supply. On the Uno, 5V. A pin set HIGH drives this voltage; a pin set LOW drives 0V."
          />
          <Term
            term="GND"
            what="Ground: the return path. Every circuit is a loop, and GND is how it closes. A circuit with no wire back to GND has nowhere for current to go."
          />
          <Term
            term="D0–D13"
            what="Digital pins. Each is either an input (reading 0V or 5V) or an output (driving 0V or 5V). The Uno's D0 and D1 are also the serial link, so using them costs you the Serial monitor."
          />
          <Term
            term="A0–A5"
            what="Analog inputs. They read a voltage between 0V and VCC and report it as a number — 0–1023 on the Uno's 10-bit ADC."
          />
          <Term
            term="Silkscreen"
            what="The white printing on the board. It is the only thing telling you which pin is which, and it is what a wiring table refers to."
          />
        </dl>
      </Section>

      <Section title="Breadboard">
        <dl className="space-y-4">
          <Term
            term="Rails"
            what="The two long rows down each edge, one red (+) and one blue (−). Each rail is one continuous connection along its whole length, and they are not joined to each other or to anything in the middle."
          />
          <Term
            term="The trench"
            what="The channel down the centre of the board. It breaks every row in two: nothing joins across it. A leg left in the trench is the single commonest reason a first circuit does nothing."
          />
          <Term
            term="A row of five"
            what="The tie points between the rails are joined sideways in groups of five. Holes in the same row of five are connected; holes in neighbouring rows are not."
          />
        </dl>
      </Section>

      <Section title="The vocabulary of a program">
        <dl className="space-y-4">
          {GLOSSARY.map((entry) => (
            <Term key={entry.term} term={entry.term} what={entry.what} readMore={entry.readMore} />
          ))}
        </dl>
      </Section>

      <Section title="Numbers worth knowing">
        <dl className="space-y-4">
          <Term
            term="I = (Vsupply − Vforward) / R"
            what="The one formula behind every current-limiting decision in this course. With a 5V supply, a red LED (Vforward ≈ 1.9V) and 220Ω, that is (5 − 1.9) / 220 ≈ 14mA."
          />
          <Term
            term="40 mA per pin, 200 mA total"
            what="The ATmega328P's limits. A pin may source or sink 40mA absolutely and 20mA as a recommendation; all the pins together may not exceed 200mA. Three LEDs at 14mA is comfortably inside both."
          />
          <Term
            term="10-bit, so 1024 steps"
            what="The Uno's ADC reports 0–1023 across 0–5V, so each count is about 4.9mV. That quantisation floor is visible in Module 3 and is a real constraint, not a rounding detail."
          />
          <Term
            term="millis() wraps at ~49.7 days"
            what="Why every non-blocking timer in this course compares with unsigned subtraction — `if (now - last >= INTERVAL)` — rather than `now >= last + INTERVAL`, which breaks once every 49.7 days."
          />
        </dl>
      </Section>

      <Section title="Where to read more">
        <ul className="space-y-2 text-sm">
          {[
            ['Language reference', 'https://docs.arduino.cc/language-reference/'],
            [
              'digitalRead / digitalWrite',
              'https://docs.arduino.cc/language-reference/en/functions/digital/',
            ],
            [
              'analogRead / analogWrite',
              'https://docs.arduino.cc/language-reference/en/functions/analog/',
            ],
            [
              'millis / micros / delay',
              'https://docs.arduino.cc/language-reference/en/functions/time/',
            ],
            ['Wire (I²C)', 'https://docs.arduino.cc/language-reference/en/functions/comm/wire/'],
            ['SPI', 'https://docs.arduino.cc/language-reference/en/functions/comm/spi/'],
          ].map(([label, href]) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--hd-accent)] underline underline-offset-2"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-[var(--hd-faint)]">
          Datasheets are where the real answers live, and they are free. The two worth having on
          hand are the <strong>ATmega328P</strong> datasheet (every pin, register and electrical
          limit of the Uno) and the datasheet for whichever sensor module you are using.
        </p>
      </Section>
    </ExerciseShell>
  );
}

function Term({ term, what, readMore }: { term: string; what: string; readMore?: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-[var(--hd-text)]">{term}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-[var(--hd-muted)]">
        {what}{' '}
        {readMore !== undefined && (
          <a
            href={readMore}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--hd-accent)] underline underline-offset-2"
          >
            Read more
          </a>
        )}
      </dd>
    </div>
  );
}
