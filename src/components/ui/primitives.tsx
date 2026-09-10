'use client';

import * as React from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Carte                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('surface rounded-[var(--radius-xl2)] p-4', className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-[0.95rem] font-bold tracking-tight', className)}
      {...props}
    />
  );
}

export function SectionHeader({
  title,
  action,
  icon,
}: {
  title: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h2 className="flex items-center gap-2 text-[0.8rem] font-bold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Champs de formulaire                                                       */
/* -------------------------------------------------------------------------- */

const fieldBase =
  'w-full rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] px-4 ' +
  'text-[16px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] ' +
  'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 ' +
  'disabled:opacity-60';
// 16 px : en dessous, Safari iOS zoome automatiquement à la mise au point.

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-12', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'py-3', className)} rows={3} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(fieldBase, 'h-12 appearance-none bg-no-repeat pr-10', className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a7867' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      backgroundPosition: 'right 0.85rem center',
      backgroundSize: '1.1rem',
    }}
    {...props}
  />
));
Select.displayName = 'Select';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold">
        {label}
        {required ? <span className="text-brand-500">*</span> : null}
        {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-alert-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </span>
      ) : null}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Case à cocher — grande cible tactile                                       */
/* -------------------------------------------------------------------------- */

export function CheckCircle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors',
        'hover:bg-[var(--bg-subtle)] disabled:opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all',
          checked
            ? 'border-sage-500 bg-sage-500 text-white'
            : 'border-[var(--line)] bg-transparent',
        )}
      >
        {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden /> : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Étiquettes                                                                 */
/* -------------------------------------------------------------------------- */

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'sage' | 'honey' | 'alert';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
    brand: 'bg-brand-100 text-brand-700',
    sage: 'bg-sage-100 text-sage-700',
    honey: 'bg-honey-100 text-honey-700',
    alert: 'bg-alert-100 text-alert-700',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* États : vide, chargement, erreur                                           */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-xl2)] px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-white/5">
          {icon}
        </div>
      ) : null}
      <p className="text-[0.95rem] font-bold">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn('h-5 w-5 animate-spin text-muted', className)}
      aria-label="Chargement"
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-[var(--bg-subtle)]', className)}
      aria-hidden
    />
  );
}

export function ErrorNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-2xl bg-alert-100 px-3.5 py-2.5 text-sm font-medium text-alert-700',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
