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
import { Button } from '@/components';
import { boardOption, boardSpecs, isBoardId } from './boardRegistry';
import { EXAMPLES } from './examples';
import { GALLERY, buildFor } from './gallery';
import { BoardArt, Chip } from './HomePage';
import { projectFor } from './projects';
import { GalleryPreview } from './ExercisePreview';

export function ProjectPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  const project = isBoardId(boardId) ? projectFor(boardId) : null;

  if (project === null) {
    return (
      <ProjectShell title="No such project">
        <p className="text-sm leading-relaxed text-slate-400">
          There is no project {boardId ?? 'here'}.{' '}
          <Link to="/" className="text-sky-400 underline underline-offset-2">
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
      <p className="max-w-[65ch] text-[15px] leading-relaxed text-slate-300">{project.tagline}</p>

      <figure>
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-6 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)]">
          <BoardArt board={board} className="h-56 w-full" />
        </div>
        <figcaption className="mt-2 text-xs leading-relaxed text-slate-500">
          The board itself, drawn by the bench's own renderer at its own size.
        </figcaption>
      </figure>

      <div className="flex flex-wrap gap-1.5" aria-label="Board specifications">
        <Chip label="logic" value={`${specs.logicVolts} V`} />
        {specs.adcCount > 0 ? (
          <Chip label="ADC" value={`${specs.adcBits}-bit`} />
        ) : (
          <Chip label="ADC" value="none" />
        )}
        <Chip label="GPIO" value={String(specs.gpioCount)} />
        <Chip label="analogue" value={String(specs.adcCount)} />
        <Chip label="PWM" value={`${specs.pwmHz} Hz`} />
      </div>

      <ProjectSection title="The featured project">
        <p className="text-sm font-medium text-slate-200">{project.project}</p>
        <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-slate-400">{project.why}</p>
      </ProjectSection>

      <ProjectSection title="Run it">
        <ul className="space-y-1.5">
          {project.youWillSee.map((sign) => (
            <li key={sign} className="flex gap-2.5 text-sm leading-relaxed text-slate-400">
              <span className="text-sky-500">·</span>
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
        {builds.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {builds.map(({ entry, build }) => (
              <li
                key={entry.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)] transition-all duration-150 ease-out hover:-translate-y-px hover:border-slate-600 hover:bg-slate-900"
              >
                <span className="block h-36 border-b border-slate-800 bg-slate-950">
                  <GalleryPreview
                    board={project.board}
                    setup={build.setup}
                    cacheKey={`gallery:${project.board}:${entry.id}`}
                    title={entry.title}
                    fit="slice"
                    className="h-full w-full"
                  />
                </span>
                <span className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
                  <span className="font-medium tracking-tight text-slate-100">{entry.title}</span>
                  <span className="text-sm leading-relaxed text-slate-400">{entry.blurb}</span>
                  <Link
                    to={`/bench/${project.board}?project=${entry.id}`}
                    className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-sky-400"
                  >
                    Open on bench
                    <ArrowRightIcon className="icon-sm" aria-hidden="true" />
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[65ch] text-sm leading-relaxed text-slate-400">
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
                className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
              >
                <p className="text-sm font-medium text-slate-200">{example.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{example.note}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  On the bench: Load an example → {example.name}.
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[65ch] text-sm leading-relaxed text-slate-400">
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
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Boards</Link>
          </Button>
          <span className="text-slate-600">/</span>
          <span className="text-sm text-slate-400">Featured project</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-100">{title}</h1>
        <div className="mt-8 space-y-10">{children}</div>
      </main>
    </div>
  );
}

function ProjectSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-slate-800 pb-2.5 text-sm font-semibold tracking-tight text-slate-100">
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}
