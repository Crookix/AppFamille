'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold ' +
    'transition-[background-color,color,box-shadow,transform] active:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-50 select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-500 text-white shadow-sm hover:bg-brand-600 focus-visible:outline-brand-600',
        secondary:
          'bg-[var(--bg-subtle)] text-[var(--fg)] hover:bg-sand-300/70 dark:hover:bg-white/10',
        outline:
          'border border-[var(--line)] bg-[var(--bg-elevated)] text-[var(--fg)] hover:bg-[var(--bg-subtle)]',
        ghost: 'text-[var(--fg)] hover:bg-[var(--bg-subtle)]',
        danger: 'bg-alert-500 text-white hover:bg-alert-700',
        sage: 'bg-sage-500 text-white hover:bg-sage-700',
      },
      size: {
        // 44 px : cible tactile confortable recommandée sur mobile.
        default: 'h-11 px-5 text-[0.95rem]',
        sm: 'h-9 px-3.5 text-sm',
        lg: 'h-13 px-7 text-base',
        icon: 'h-11 w-11',
        iconSm: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
