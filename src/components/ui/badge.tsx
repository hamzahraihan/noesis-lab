// src/components/ui/badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-baseline gap-1.5 rounded-none px-2 py-1 text-xs [&_span:first-child]:text-slate-500 [&_span:last-child]:font-medium [&_span:last-child]:text-slate-200 [&_span:last-child]:tabular-nums',
  {
    variants: {
      variant: {
        secondary: 'bg-slate-800',
        outline: 'shadow-[inset_0_0_0_1px_var(--color-slate-700)]',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge };
