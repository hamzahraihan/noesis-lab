/**
 * Board featured projects: one showcase page per board.
 *
 * The homepage is the index, so there is no list route — only the detail
 * page. The bench is one click away behind Open in bench, which needs no
 * plumbing: `/bench/:boardId` already opens with the starter project wired
 * and its sketch loaded.
 */

import { Link, useParams } from 'react-router';
import { ArrowRightIcon } from '@radix-ui/react-icons';
import { Badge, Button, Navbar } from '@/components';
import { boardOption, boardSpecs, isBoardId } from './boardRegistry';
import { EXAMPLES } from './examples';
import { GALLERY, buildFor } from './gallery';
import { BoardArt } from './HomePage';
import { projectFor } from './projects';
import { GalleryPreview } from './ExercisePreview';

export function ProjectPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  const project = isBoardId(boardId) ? projectFor(boardId) : null;

  if (project === null) {
    return (
      <ProjectShell title="No such project">
        <p className="text-sm leading-relaxed text-[var(--hd-muted)]">
          There is no project {boardId ?? 'here'}.{' '}
          <Link to="/" className="text-[var(--hd-accent)] underline underline-offset-2">
            Back to the boards
          </Link>
          .
        </p>
      </ProjectShell>
    );
  }

  const board = boardOption(project.board);
  const specs = boardSpecs(project.board);
  const next = EXAMPLES.filter((example) => project.tryNext.includes(example.id));
  /*
   * The finished builds for this board: gallery projects with a validated
   * build on its headers. Uno has six; boards whose batches have not landed
   * yet show the honest empty state below instead of a thin list.
   */
  const builds = GALLERY.flatMap((entry) => {
    const build = buildFor(entry, project.board);
    return build === null ? [] : [{ entry, build }];
  });

  return (
    <ProjectShell title={board.name}>
      <p className="max-w-[65ch] text-sm leading-relaxed text-[var(--hd-text)]">{project.tagline}</p>

      <figure>
        <div className="overflow-hidden rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg)]/60 p-6 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)]">
          <BoardArt board={board} className="h-56 w-full" />
        </div>
        <figcaption className="mt-2 text-xs leading-relaxed text-[var(--hd-faint)]">
          The board itself, drawn by the bench's own renderer at its own size.
        </figcaption>
      </figure>

      <div className="flex flex-wrap gap-1.5" aria-label="Board specifications">
        <Badge>
          <span>logic</span>
          <span>{`${specs.logicVolts} V`}</span>
        </Badge>
        {specs.adcCount > 0 ? (
          <Badge>
            <span>ADC</span>
            <span>{`${specs.adcBits}-bit`}</span>
          </Badge>
        ) : (
          <Badge>
            <span>ADC</span>
            <span>none</span>
          </Badge>
        )}
        <Badge>
          <span>GPIO</span>
          <span>{String(specs.gpioCount)}</span>
        </Badge>
        <Badge>
          <span>analogue</span>
          <span>{String(specs.adcCount)}</span>
        </Badge>
        <Badge>
          <span>PWM</span>
          <span>{`${specs.pwmHz} Hz`}</span>
        </Badge>
      </div>

      <ProjectSection title="The featured project">
        <p className="text-sm font-medium text-[var(--hd-text)]">{project.project}</p>
        <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">{project.why}</p>
      </ProjectSection>

      <ProjectSection title="Run it">
        <ul className="space-y-1.5">
          {project.youWillSee.map((sign) => (
            <li key={sign} className="flex gap-2.5 text-sm leading-relaxed text-[var(--hd-muted)]">
              <span className="text-[var(--hd-accent)]">·</span>
              <span>{sign}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Button asChild size="sm">
            <Link to={`/bench/${project.board}`}>Open in bench</Link>
          </Button>
        </div>
      </ProjectSection>

      <ProjectSection title="Finished projects">
        <p className="mb-3 text-sm leading-relaxed text-[var(--hd-muted)]">
          <Link to="/diagnostics" className="text-[var(--hd-accent)] underline underline-offset-2">
            Smoke-test the gallery
          </Link>{' '}
          — run every finished build through the automated smoke harness.
        </p>
        {builds.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {builds.map(({ entry, build }) => (
              <li
                key={entry.id}
                className="flex flex-col overflow-hidden rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)]/60 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)] transition-all duration-150 ease-out hover:-translate-y-px hover:border-slate-600 hover:bg-[var(--hd-surface)]"
              >
                <span className="block h-36 border-b border-[var(--hd-border)] bg-[var(--hd-bg)]">
                  <GalleryPreview
                    board={project.board}
                    circuit={build.circuit}
                    cacheKey={`gallery:${project.board}:${entry.id}`}
                    title={entry.title}
                    fit="slice"
                    className="h-full w-full"
                  />
                </span>
                <span className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
                  <span className="font-medium tracking-tight text-[var(--hd-text)]">{entry.title}</span>
                  <span className="text-sm leading-relaxed text-[var(--hd-muted)]">{entry.blurb}</span>
                  <Link
                    to={`/bench/${project.board}?project=${entry.id}`}
                    className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-[var(--hd-accent)]"
                  >
                    Open on bench
                    <ArrowRightIcon className="icon-sm" aria-hidden="true" />
                  </Link>
                  {entry.builds
                    .filter((b) => b.board === project.board && b.variant !== undefined)
                    .map((b) => (
                      <Link
                        key={b.variant}
                        to={`/bench/${project.board}?project=${entry.id}&variant=${b.variant}`}
                        className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-[var(--hd-accent)]"
                      >
                        Open {b.variant} build (AVR)
                        <ArrowRightIcon className="icon-sm" aria-hidden="true" />
                      </Link>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">
            No finished projects for this board yet — its batch is still being built and
            validated. The starter bench above runs today; check back soon.
          </p>
        )}
      </ProjectSection>

      <ProjectSection title="Try next">
        {next.length > 0 ? (
          <ul className="space-y-2.5">
            {next.map((example) => (
              <li
                key={example.id}
                className="rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)]/60 px-4 py-3"
              >
                <p className="text-sm font-medium text-[var(--hd-text)]">{example.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--hd-muted)]">{example.note}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--hd-faint)]">
                  On the bench: Load an example → {example.name}.
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[65ch] text-sm leading-relaxed text-[var(--hd-muted)]">
            The examples above are Arduino sketches, and this bench speaks Python — start from
            the Python blink it opens with instead.
          </p>
        )}
      </ProjectSection>
    </ProjectShell>
  );
}

function ProjectShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--hd-bg)] text-[var(--hd-text)] antialiased">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=JetBrains+Mono:wght@400;500&display=swap" />
      <Navbar />
      <div className="mx-auto max-w-3xl px-6 py-3 text-xs text-[var(--hd-faint)]">
        <Link to="/boards" className="transition-colors hover:text-[var(--hd-muted)]">Boards</Link>
        <span className="mx-2">/</span>
        <span>Featured project</span>
      </div>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-['Archivo'] text-2xl font-black tracking-tight text-balance text-[var(--hd-text)]">{title}</h1>
        <div className="mt-8 space-y-10">{children}</div>
      </main>
    </div>
  );
}

function ProjectSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-[var(--hd-border)] pb-2.5 text-sm font-semibold tracking-tight text-[var(--hd-text)]">
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}
