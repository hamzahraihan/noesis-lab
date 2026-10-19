import type { ReactNode } from 'react';

export function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--hd-border)] pr-3 pl-4">
      {children}
    </header>
  );
}
