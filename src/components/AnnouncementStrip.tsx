import { useEffect, useState } from 'react';

const STORAGE_KEY = 'noesis-announcement-dismissed';

export function AnnouncementStrip() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setDismissed(true);
    } catch {
      /* ignore */
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border-b border-[var(--hd-border)] bg-[var(--hd-success)]/[0.06]">
      <div className="flex items-center gap-3 px-6 py-2.5 font-['JetBrains_Mono'] text-xs uppercase tracking-[0.18em] text-[var(--hd-success)]">
        <span className="h-1.5 w-1.5 bg-[var(--hd-success)]" aria-hidden="true" />
        <span className="flex-1">
          New: the Uno bench runs in your browser -
          <a href="/learn" className="underline underline-offset-2 hover:text-[var(--hd-text)]">
            start with exercise 0.1
          </a>
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="text-[var(--hd-muted)] transition-colors hover:text-[var(--hd-text)]"
        >
          x
        </button>
      </div>
    </div>
  );
}
