import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DEFAULT_BOARD_ID } from '@/features/learn';

function applyTheme(theme: 'ink' | 'paper') {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('noesis-theme', theme);
  } catch {
    /* ignore */
  }
}

export function Navbar() {
  const [theme, setTheme] = useState<'ink' | 'paper'>('ink');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('noesis-theme');
    } catch {
      stored = null;
    }
    const initial = stored === 'paper' ? 'paper' : 'ink';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = (next: 'ink' | 'paper') => {
    setTheme(next);
    applyTheme(next);
  };

  const links = [
    { to: '/learn', label: 'Learn' },
    { to: '/boards', label: 'Boards' },
    { to: `/projects/${DEFAULT_BOARD_ID}`, label: 'Bench' },
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
                onClick={() => toggle(t)}
                aria-pressed={theme === t}
                className={
                  theme === t
                    ? 'bg-[var(--hd-accent)] px-2.5 py-1 font-[\'JetBrains_Mono\'] text-xs uppercase tracking-[0.18em] text-[var(--hd-bg)]'
                    : 'bg-[var(--hd-surface)] px-2.5 py-1 font-[\'JetBrains_Mono\'] text-xs uppercase tracking-[0.18em] text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]'
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
            to={`/projects/${DEFAULT_BOARD_ID}`}
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
                to={`/projects/${DEFAULT_BOARD_ID}`}
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
