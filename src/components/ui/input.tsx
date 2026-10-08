// src/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-transparent bg-slate-800 px-2 py-1 text-xs text-slate-200 shadow-xs transition-colors outline-none placeholder:text-slate-500 hover:bg-slate-700 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
