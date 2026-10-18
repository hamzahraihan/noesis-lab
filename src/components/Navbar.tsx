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

  const toggle = () => {
    const next = theme === 'ink' ? 'paper' : 'ink';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-5">
      <Link
        to="/"
        className="flex items-center gap-2 font-['Archivo'] text-lg font-black tracking-tight text-[var(--hd-text)]"
      >
        <span className="inline-block h-2.5 w-2.5 bg-[var(--hd-accent)]" aria-hidden="true" />
        noesis
      </Link>
      <div className="hidden items-center gap-5 text-sm text-[var(--hd-muted)] md:flex">
        <Link to="/learn" className="transition-colors hover:text-[var(--hd-text)]">
          Learn
        </Link>
        <Link to="/boards" className="transition-colors hover:text-[var(--hd-text)]">
          Boards
        </Link>
        <Link
          to={`/projects/${DEFAULT_BOARD_ID}`}
          className="transition-colors hover:text-[var(--hd-text)]"
        >
          Bench
        </Link>
        <Link to="/learn/references" className="transition-colors hover:text-[var(--hd-text)]">
          References
        </Link>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle ink/paper theme"
          className="rounded-none border border-[var(--hd-border)] bg-[var(--hd-surface)] px-3 py-1.5 text-xs font-medium text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
        >
          {theme === 'ink' ? 'ink' : 'paper'}
        </button>
        <Link
          to={`/projects/${DEFAULT_BOARD_ID}`}
          className="rounded-none bg-[var(--hd-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--hd-bg)] transition-colors hover:bg-[var(--hd-accent-hover)]"
        >
          Open bench
        </Link>
      </div>
    </nav>
  );
}