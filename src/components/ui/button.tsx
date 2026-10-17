// src/components/ui/button.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-none text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Old .ctl-accent: the one action a panel exists to offer.
        default: 'bg-primary text-primary-foreground hover:bg-[var(--color-accent)]',
        // Old .ctl-quiet: the default thing you press.
        secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-700',
        // Old .ctl-outline: a secondary commitment.
        outline:
          'bg-transparent text-slate-300 shadow-[inset_0_0_0_1px_var(--color-slate-700)] hover:bg-slate-800 hover:text-slate-100',
        // Old .ctl-danger: destructive and nothing else.
        destructive:
          'bg-transparent text-red-300 shadow-[inset_0_0_0_1px_var(--color-red-900)] hover:bg-red-950 hover:text-red-200',
        ghost: 'hover:bg-slate-800 hover:text-slate-100',
      },
      size: {
        sm: 'h-7 px-2.5',
        default: 'h-8 px-3',
        icon: 'size-8 p-0',
        'icon-sm': 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'sm' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
