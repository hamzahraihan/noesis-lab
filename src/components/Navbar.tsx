import { useEffect, useState } from 'react';
import { Link } from 'react-router';

function applyTheme(theme: 'ink' | 'paper') {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('noesis-theme', theme);
  } catch {
    /* ignore */
  }
}

/** The theme the operator last chose, or the default when nothing is stored. */
function storedTheme(): 'ink' | 'paper' {
  try {
    return localStorage.getItem('noesis-theme') === 'paper' ? 'paper' : 'ink';
  } catch {
    return 'ink';
  }
}

/**
 * The site-wide nav.
 *
 * `defaultBoardId` arrives as a prop because this component is shared: a
 * `components/` file may not take a value edge into a feature, which is the
 * same rule `BenchRoute` honours by handing `Bench` the learn constants it
 * needs rather than letting it import them.
 */
export function Navbar({ defaultBoardId }: { defaultBoardId: string }) {
  const [theme, setTheme] = useState<'ink' | 'paper'>(storedTheme);
  const [open, setOpen] = useState(false);

  /*
   * Applying is the effect's job rather than the click's: the document
   * attribute and the stored choice follow the state, wherever it came from.
   */
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const links = [
    { to: '/learn', label: 'Learn' },
    { to: '/boards', label: 'Boards' },
    { to: `/projects/${defaultBoardId}`, label: 'Bench' },
    { to: '/learn/references', label: 'References' },
  ];

  return (
    <nav className="border-b border-[var(--hd-border)]">
      <div className="flex items-center gap-6 px-6 py-5">
        <Link
          to="/"
          className="flex items-center gap-2 font-['Archivo'] text-lg font-black tracking-tight text-[var(--hd-text)]"
        >
          <span className="inline-block h-2.5 w-2.5 bg-[var(--hd-accent)]" aria-hidden="true" />
          noesis
        </Link>

        <div className="hidden items-center gap-5 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div
            role="group"
            aria-label="Theme"
            className="flex overflow-hidden border border-[var(--hd-border)]"
          >
            {(['ink', 'paper'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={
                  theme === t
                    ? "bg-[var(--hd-accent)] px-2.5 py-1 font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-bg)]"
                    : "bg-[var(--hd-surface)] px-2.5 py-1 font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
                }
              >
                {t}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="md:hidden border border-[var(--hd-border)] bg-[var(--hd-surface)] px-2.5 py-1 font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-muted)]"
            aria-expanded={open}
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'close' : 'menu'}
          </button>

          <Link
            to={`/projects/${defaultBoardId}`}
            className="hidden rounded-none bg-[var(--hd-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--hd-bg)] transition-colors hover:bg-[var(--hd-accent-hover)] sm:inline-block"
          >
            Open bench
          </Link>
        </div>
      </div>

      {open && (
        <div className="border-t border-[var(--hd-border)] px-6 py-3 md:hidden">
          <ul className="flex flex-col gap-2">
            {links.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className="block font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to={`/projects/${defaultBoardId}`}
                onClick={() => setOpen(false)}
                className="block font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-accent)]"
              >
                Open bench
              </Link>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}
