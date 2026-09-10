'use client';

import * as React from 'react';
import { cn, colorHex, initials } from '@/lib/utils';

type Size = 'xs' | 'sm' | 'md' | 'lg';

const sizes: Record<Size, string> = {
  xs: 'h-6 w-6 text-[0.6rem]',
  sm: 'h-8 w-8 text-[0.7rem]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-16 w-16 text-lg',
};

/**
 * Pastille d'identité : photo si elle existe, sinon initiales sur la couleur
 * du membre. Chaque personne du foyer garde ainsi la même couleur partout.
 */
export function Avatar({
  name,
  color,
  photoUrl,
  size = 'md',
  className,
  ring,
}: {
  name: string | null | undefined;
  color?: string | null;
  photoUrl?: string | null;
  size?: Size;
  className?: string;
  ring?: boolean;
}) {
  const hex = colorHex(color);

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white',
        sizes[size],
        ring && 'ring-2 ring-[var(--bg-elevated)]',
        className,
      )}
      style={{ backgroundColor: hex }}
      title={name ?? undefined}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée à durée de vie courte, non optimisable par le CDN d'images.
        <img
          src={photoUrl}
          alt={name ?? ''}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span className="sr-only">{name ?? 'Sans nom'}</span>
    </span>
  );
}

/** Petit groupe d'avatars empilés (participants d'un événement). */
export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
}: {
  people: { name: string | null; color?: string | null; photoUrl?: string | null }[];
  max?: number;
  size?: Size;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} {...p} size={size} ring />
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-[var(--bg-subtle)] font-bold text-[var(--fg-muted)] ring-2 ring-[var(--bg-elevated)]',
            sizes[size],
          )}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/** Sélecteur de couleur de membre. */
export function ColorPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (color: string) => void;
  options: readonly { key: string; label: string; hex: string }[];
}) {
  return (
    <div role="radiogroup" aria-label="Couleur" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          aria-label={option.label}
          onClick={() => onChange(option.key)}
          className={cn(
            'h-9 w-9 rounded-full transition-transform',
            value === option.key
              ? 'scale-110 ring-2 ring-[var(--fg)] ring-offset-2 ring-offset-[var(--bg-elevated)]'
              : 'hover:scale-105',
          )}
          style={{ backgroundColor: option.hex }}
        />
      ))}
    </div>
  );
}
