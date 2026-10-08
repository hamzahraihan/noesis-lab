/**
 * The exercise guide: popup instructions on the bench.
 *
 * The bench already wires the circuit and loads the sketch when it arrives
 * through `?ex=:id` — but it showed no guidance, so the learner had to memorise
 * the steps or tab back to `/learn`. This surfaces the same exercise data the
 * Learn page renders (brief, steps, wiring, hints) as an auto-opening guided
 * dialog with step navigation, so the work happens where the wires are.
 *
 * Operate mode: the visitor completes a task. Scanability and consistency with
 * the bench chrome (slate-950, one sky accent, shadcn Button controls,
 * `panel-title` headings) outrank expression.
 */

import { useEffect, useId, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  Cross2Icon,
  InfoCircledIcon,
  ReaderIcon,
} from '@radix-ui/react-icons';
import { Link } from 'react-router';
import { Button, Dialog, DialogContent, DialogTitle } from '@/components';
import type { Exercise } from './exercises';
import { ExercisePreview } from './ExercisePreview';
import { isGuideDismissed, setGuideDismissed } from './guide-dismissal';

function isBoardPin(name: string): boolean {
  return /^(D\d{1,2}|A\d|TX|RX|GPIO\d{1,2}|\dV3?|GND|AREF|RESET|IOREF)$/.test(name);
}

export function ExerciseGuide({
  exercise,
  open,
  onClose,
}: {
  exercise: Exercise;
  open: boolean;
  onClose(): void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [hintsRevealed, setHintsRevealed] = useState(0);
  // Read once per mount. The bench remounts this dialog per exercise (see the
  // `key` at the call site), so a second exercise never opens mid-way through
  // the previous one's progress — and closing then reopening the same exercise
  // keeps the steps already marked done.
  const [dontShow, setDontShow] = useState(() => isGuideDismissed(exercise.id));
  const titleId = useId();

  // Esc closes through Radix (`onOpenChange` → `close`), and the background
  // stops scrolling while the dialog is up.
  // The bench canvas keeps its own key handler; it ignores keys from inputs
  // but not from here, so stop propagation to avoid e.g. Space toggling Run.
  // Escape itself is left alone so it reaches Radix, which owns dismissal.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const totalSteps = exercise.steps.length;
  const currentStep = exercise.steps[Math.min(stepIndex, totalSteps - 1)] ?? '';
  const doneCount = done.size;
  const progress = totalSteps === 0 ? 0 : (doneCount / totalSteps) * 100;

  const toggleDone = (index: number) => {
    setDone((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const close = () => {
    setGuideDismissed(exercise.id, dontShow);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="guide-panel flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden bg-slate-900 p-0 sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">{exercise.title}</DialogTitle>
        {/* Header: what this is, and the way out. */}
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-800 px-5 pt-4 pb-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <ReaderIcon className="icon" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] tracking-wide text-slate-500">
              EXERCISE {exercise.id} · {exercise.difficulty.toUpperCase()} · {exercise.minutes.toUpperCase()}
            </p>
            <h2 id={titleId} className="mt-0.5 text-lg font-semibold tracking-tight text-balance text-slate-100">
              {exercise.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{exercise.module}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={close}
            aria-label="Close the exercise guide"
            title="Close (Esc)"
            className="shrink-0"
          >
            <Cross2Icon className="icon" aria-hidden="true" />
          </Button>
        </div>

        {/* Progress: how far through the build. A linear bar, because it is
            real content — which step the learner is on — not decoration. */}
        <div className="shrink-0 border-b border-slate-800 px-5 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Step {Math.min(stepIndex + 1, totalSteps)} of {totalSteps}
            </span>
            <span className="num text-slate-500">
              {doneCount} done
            </span>
          </div>
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-label="Build progress"
          >
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Body: brief first, then the current step, then reference tables. */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <p className="max-w-[65ch] text-sm leading-relaxed text-slate-300">{exercise.brief}</p>

          <div className="flex flex-wrap gap-1.5">
            {exercise.concepts.map((concept) => (
              <span
                key={concept}
                className="rounded-md bg-slate-800 px-2 py-1 text-[11px] leading-tight text-slate-400"
              >
                {concept}
              </span>
            ))}
          </div>

          {/*
           * What the bench behind this dialog is meant to become: the finished
           * wiring, for comparing a circuit that has been taken apart and put
           * back together against. Unpowered here, so nothing is lit — the
           * bench itself is where it runs.
           */}
          <figure>
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
              <ExercisePreview exercise={exercise} fit="slice" className="h-32 w-full" />
            </div>
            <figcaption className="mt-1.5 text-xs leading-relaxed text-slate-500">
              What you are building toward — the finished wiring.
            </figcaption>
          </figure>

          {exercise.solution !== undefined && (
            <section aria-label="When it is working">
              <h3 className="panel-title">
                <CheckIcon className="icon-sm" aria-hidden="true" />
                When it is working
              </h3>
              <ul className="mt-2 space-y-1.5">
                {exercise.solution.working.map((sign) => (
                  <li key={sign} className="flex gap-2.5 text-sm leading-relaxed text-slate-400">
                    <CheckIcon className="icon-sm mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    <span>{sign}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Build steps">
            <h3 className="panel-title">
              <CheckIcon className="icon-sm" aria-hidden="true" />
              Build it
            </h3>
            <div className="mt-2.5 rounded-lg border border-slate-700/80 bg-slate-950/60 p-4">
              <p className="text-sm leading-relaxed text-slate-200">{currentStep}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                  disabled={stepIndex === 0}
                >
                  <ArrowLeftIcon className="icon" aria-hidden="true" />
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={done.has(stepIndex) ? 'default' : 'outline'}
                  onClick={() => toggleDone(stepIndex)}
                  aria-pressed={done.has(stepIndex)}
                >
                  <CheckIcon className="icon" aria-hidden="true" />
                  {done.has(stepIndex) ? 'Done' : 'Mark done'}
                </Button>
                {stepIndex < totalSteps - 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setStepIndex((index) => Math.min(totalSteps - 1, index + 1))}
                  >
                    Next step
                    <ArrowRightIcon className="icon" aria-hidden="true" />
                  </Button>
                ) : (
                  <span className="text-xs text-slate-500">Last step — press Run when ready.</span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Jump to a step">
                {exercise.steps.map((step, index) => (
                  <button
                    key={step.slice(0, 24) + index}
                    type="button"
                    onClick={() => setStepIndex(index)}
                    aria-label={`Go to step ${index + 1}`}
                    aria-current={index === stepIndex ? 'step' : undefined}
                    title={`Step ${index + 1}`}
                    className={`size-6 rounded-md font-mono text-[11px] transition-colors ${
                      index === stepIndex
                        ? 'bg-sky-600 text-white'
                        : done.has(index)
                          ? 'bg-emerald-950 text-emerald-400'
                          : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'
                    }`}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section aria-label="Wiring">
            <h3 className="panel-title">
              <span className="font-mono text-[11px]">⌁</span>
              Wiring
            </h3>
            <table className="mt-2.5 w-full text-sm">
              <tbody>
                {exercise.wiring.map((row, index) => (
                  <tr
                    key={`${row.pin}-${row.part}-${row.terminal}-${index}`}
                    className="border-b border-slate-800/60 last:border-0"
                  >
                    <td
                      className={`w-16 py-1.5 pr-3 font-mono text-xs ${
                        isBoardPin(row.pin) ? 'text-sky-400' : 'text-slate-500'
                      }`}
                    >
                      {row.pin}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-200">{row.part}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-slate-400">{row.terminal}</td>
                    <td className="py-1.5 text-slate-400">{row.goesTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-label="Parts">
            <h3 className="panel-title">On the bench already</h3>
            <ul className="mt-2.5 space-y-1.5">
              {exercise.parts.map((entry) => (
                <li key={entry.name} className="flex gap-2.5 text-sm">
                  <span className="num w-7 shrink-0 text-right font-mono text-xs text-slate-500">
                    {entry.qty}×
                  </span>
                  <span className="text-slate-200">{entry.name}</span>
                  <span className="text-slate-500">— {entry.why}</span>
                </li>
              ))}
            </ul>
          </section>

          {exercise.fault !== undefined && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-200">
                <InfoCircledIcon className="icon-sm shrink-0" aria-hidden="true" />
                Break it on purpose
              </p>
              <p className="mt-1.5 text-sm font-medium text-amber-100/90">{exercise.fault.break_}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{exercise.fault.teaches}</p>
            </div>
          )}

          <section aria-label="Hints">
            <h3 className="panel-title">Stuck?</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Try it first — the guessing is the skill. Take hints one at a time.
            </p>
            <div className="mt-2.5 space-y-2">
              {exercise.hints.slice(0, hintsRevealed).map((hint) => (
                <div key={hint.when} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                  <p className="text-sm font-medium text-slate-200">{hint.when}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{hint.answer}</p>
                </div>
              ))}
            </div>
            {hintsRevealed < exercise.hints.length && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHintsRevealed((count) => count + 1)}
                className="mt-2.5"
              >
                {hintsRevealed === 0
                  ? 'Show a hint'
                  : `Another hint (${exercise.hints.length - hintsRevealed} left)`}
              </Button>
            )}
          </section>
        </div>

        {/* Footer: the way back to the full lesson, and the way onto the bench. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-800 bg-slate-950/40 px-5 py-3">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/learn/${exercise.id}`}>Full lesson {exercise.id}</Link>
          </Button>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(event) => setDontShow(event.target.checked)}
              className="size-3.5 accent-sky-500"
            />
            Don&apos;t auto-open
          </label>
          <span className="flex-1" />
          <Button type="button" size="sm" onClick={close}>
            Start building
            <ArrowRightIcon className="icon" aria-hidden="true" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
