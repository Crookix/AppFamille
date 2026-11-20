'use client';

import * as React from 'react';
import { Input } from '@/components/ui/primitives';
import { useHousehold } from '@/components/providers/household-provider';
import { cn } from '@/lib/utils';

/** Pour qui est une idée cadeau : un prénom, et l'enfant s'il en est un. */
export type Recipient = { label: string; childId: string | null };

/**
 * « Pour qui ? » : les enfants et les adultes du foyer en un appui, ou un nom
 * libre pour quelqu'un d'autre (Mamie, la maîtresse…).
 *
 * Le prénom est toujours gardé dans `label`, même pour un enfant : si la fiche
 * de l'enfant est un jour supprimée, l'idée garde son destinataire.
 */
export function RecipientPicker({
  value,
  onChange,
}: {
  value: Recipient | null;
  onChange: (next: Recipient | null) => void;
}) {
  const { children, members } = useHousehold();

  const options: Recipient[] = [
    ...children.map((c) => ({ label: c.first_name, childId: c.id })),
    ...members.map((m) => ({ label: m.display_name.trim().split(/\s+/)[0], childId: null })),
  ].filter((option, index, all) => all.findIndex((o) => o.label === option.label) === index);

  const isOption = (candidate: Recipient | null) =>
    candidate !== null && options.some((o) => o.label === candidate.label);

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">
        Pour qui ? <span className="text-xs font-normal text-muted">facultatif</span>
      </legend>
      <div role="radiogroup" aria-label="Pour qui" className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value?.label === option.label;
          return (
            <button
              key={`${option.childId ?? 'adulte'}-${option.label}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected ? null : option)}
              className={cn(
                'tap h-10 rounded-full border-2 px-4 text-sm font-semibold transition-colors',
                selected
                  ? 'border-transparent bg-brand-500 text-white'
                  : 'border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <Input
        value={value && !isOption(value) ? value.label : ''}
        onChange={(e) => {
          const text = e.target.value;
          onChange(text.trim() ? { label: text, childId: null } : null);
        }}
        placeholder="Quelqu'un d'autre…"
        aria-label="Quelqu'un d'autre"
        maxLength={80}
        className="mt-2 h-11"
      />
    </fieldset>
  );
}
