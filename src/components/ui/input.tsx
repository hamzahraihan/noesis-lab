// src/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-7 w-full min-w-0 rounded-none border border-transparent bg-[var(--hd-border)] px-2 py-1 text-xs text-[var(--hd-text)] shadow-xs transition-colors outline-none placeholder:text-[var(--hd-muted)] hover:bg-[var(--hd-border-strong)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
