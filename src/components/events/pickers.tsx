'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn, colorHex } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Field, Input, Select } from '@/components/ui/primitives';
import { useHousehold } from '@/components/providers/household-provider';
import {
  buildRecurrenceRule,
  recurrenceToPreset,
  type RecurrencePreset,
} from '@/lib/recurrence';

/* -------------------------------------------------------------------------- */
/* Personnes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sélection multiple d'adultes et d'enfants sous forme de pastilles.
 *
 * Chaque personne garde sa couleur : on reconnaît qui est concerné d'un coup
 * d'œil, sans lire les prénoms.
 */
export function PeoplePicker({
  memberIds,
  childIds,
  onChange,
  label = 'Qui est concerné',
}: {
  memberIds: string[];
  childIds: string[];
  onChange: (next: { memberIds: string[]; childIds: string[] }) => void;
  label?: string;
}) {
  const { members, children } = useHousehold();

  function toggleMember(id: string) {
    onChange({
      memberIds: memberIds.includes(id)
        ? memberIds.filter((m) => m !== id)
        : [...memberIds, id],
      childIds,
    });
  }

  function toggleChild(id: string) {
    onChange({
      memberIds,
      childIds: childIds.includes(id)
        ? childIds.filter((c) => c !== id)
        : [...childIds, id],
    });
  }

  if (members.length === 0 && children.length === 0) return null;

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {members.map((member) => (
          <PersonChip
            key={member.id}
            name={member.display_name}
            color={member.color}
            selected={memberIds.includes(member.id)}
            onToggle={() => toggleMember(member.id)}
          />
        ))}
        {children.map((child) => (
          <PersonChip
            key={child.id}
            name={child.first_name}
            color={child.color}
            selected={childIds.includes(child.id)}
            onToggle={() => toggleChild(child.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function PersonChip({
  name,
  color,
  selected,
  onToggle,
}: {
  name: string;
  color: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={cn(
        'flex h-10 items-center gap-2 rounded-full border-2 pl-1 pr-3 text-sm font-semibold transition-all',
        selected
          ? 'border-transparent text-white'
          : 'border-[var(--line)] bg-[var(--bg-elevated)] text-[var(--fg)] hover:bg-[var(--bg-subtle)]',
      )}
      style={selected ? { backgroundColor: colorHex(color) } : undefined}
    >
      {selected ? (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/25">
          <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
        </span>
      ) : (
        <Avatar name={name} color={color} size="sm" />
      )}
      {name}
    </button>
  );
}

/** Sélection d'un seul adulte (responsable, dépose, récupère). */
export function MemberSelect({
  value,
  onChange,
  label,
  hint,
  placeholder = 'Personne',
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  label: string;
  hint?: string;
  placeholder?: string;
}) {
  const { members } = useHousehold();

  return (
    <Field label={label} hint={hint}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.display_name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Récurrence                                                                 */
/* -------------------------------------------------------------------------- */

const PRESET_LABELS: { key: RecurrencePreset['type']; label: string }[] = [
  { key: 'aucune', label: 'Une seule fois' },
  { key: 'quotidienne', label: 'Tous les jours' },
  { key: 'hebdomadaire', label: 'Toutes les semaines' },
  { key: 'toutes_deux_semaines', label: 'Une semaine sur deux' },
  { key: 'jours', label: 'Certains jours' },
  { key: 'mensuelle', label: 'Tous les mois' },
];

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * Choix de répétition.
 *
 * La règle produite ne fixe pas de jour de la semaine pour « toutes les
 * semaines » : c'est la date de l'événement qui le détermine. Seul le mode
 * « certains jours » nomme explicitement des jours.
 */
export function RecurrencePicker({
  rule,
  onChange,
}: {
  rule: string | null;
  onChange: (next: string | null) => void;
}) {
  const preset = recurrenceToPreset(rule);
  const [weekdays, setWeekdays] = React.useState<number[]>(
    preset.type === 'jours' ? preset.weekdays : [],
  );
  const [until, setUntil] = React.useState<string>(() => {
    const match = rule?.match(/UNTIL=(\d{4})(\d{2})(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  });

  function apply(next: RecurrencePreset, nextWeekdays = weekdays, nextUntil = until) {
    const endDate = nextUntil ? new Date(`${nextUntil}T23:59:59Z`) : null;
    if (next.type === 'jours') {
      onChange(buildRecurrenceRule({ type: 'jours', weekdays: nextWeekdays }, endDate));
      return;
    }
    onChange(buildRecurrenceRule(next, endDate));
  }

  function toggleWeekday(index: number) {
    const next = weekdays.includes(index)
      ? weekdays.filter((d) => d !== index)
      : [...weekdays, index].sort((a, b) => a - b);
    setWeekdays(next);
    apply({ type: 'jours', weekdays: next }, next);
  }

  return (
    <div className="space-y-3">
      <Field label="Répétition">
        <Select
          value={preset.type === 'personnalisee' ? 'personnalisee' : preset.type}
          onChange={(e) => {
            const type = e.target.value as RecurrencePreset['type'];
            if (type === 'jours') {
              const initial = weekdays.length > 0 ? weekdays : [new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
              setWeekdays(initial);
              apply({ type: 'jours', weekdays: initial }, initial);
            } else if (type === 'personnalisee') {
              /* on conserve la règle existante */
            } else {
              apply({ type } as RecurrencePreset);
            }
          }}
        >
          {PRESET_LABELS.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
          {preset.type === 'personnalisee' ? (
            <option value="personnalisee">Règle personnalisée</option>
          ) : null}
        </Select>
      </Field>

      {preset.type === 'jours' ? (
        <div>
          <span className="mb-1.5 block text-sm font-semibold">Jours</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                role="checkbox"
                aria-checked={weekdays.includes(index)}
                onClick={() => toggleWeekday(index)}
                className={cn(
                  'h-10 min-w-11 rounded-full px-3 text-sm font-semibold transition-colors',
                  weekdays.includes(index)
                    ? 'bg-brand-500 text-white'
                    : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {preset.type !== 'aucune' ? (
        <Field label="Jusqu'au" hint="facultatif">
          <Input
            type="date"
            value={until}
            onChange={(e) => {
              setUntil(e.target.value);
              apply(preset, weekdays, e.target.value);
            }}
          />
        </Field>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rappels                                                                    */
/* -------------------------------------------------------------------------- */

const REMINDER_CHOICES = [
  { minutes: 0, label: "À l'heure" },
  { minutes: 10, label: '10 min avant' },
  { minutes: 30, label: '30 min avant' },
  { minutes: 60, label: '1 h avant' },
  { minutes: 1440, label: 'La veille' },
];

export function ReminderPicker({
  reminders,
  onChange,
}: {
  reminders: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Rappels</legend>
      <div className="flex flex-wrap gap-1.5">
        {REMINDER_CHOICES.map(({ minutes, label }) => {
          const selected = reminders.includes(minutes);
          return (
            <button
              key={minutes}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() =>
                onChange(
                  selected
                    ? reminders.filter((m) => m !== minutes)
                    : [...reminders, minutes].sort((a, b) => a - b),
                )
              }
              className={cn(
                'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
                selected
                  ? 'bg-sage-500 text-white'
                  : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Catégories                                                                 */
/* -------------------------------------------------------------------------- */

export const CATEGORY_META = {
  famille: { label: 'Famille', color: '#de6f47' },
  ecole: { label: 'École', color: '#4a90a4' },
  sante: { label: 'Santé', color: '#c9628a' },
  activite: { label: 'Activité', color: '#6da887' },
  voyage: { label: 'Voyage', color: '#8b7bb8' },
  garde: { label: 'Garde', color: '#e9b04a' },
  perso: { label: 'Perso', color: '#8a9a5b' },
} as const;

export type CategoryKey = keyof typeof CATEGORY_META;

export function CategoryPicker({
  value,
  onChange,
}: {
  value: CategoryKey;
  onChange: (next: CategoryKey) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Catégorie</legend>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(CATEGORY_META) as CategoryKey[]).map((key) => {
          const meta = CATEGORY_META[key];
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(key)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
                selected
                  ? 'text-white'
                  : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
              )}
              style={selected ? { backgroundColor: meta.color } : undefined}
            >
              {!selected ? (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                  aria-hidden
                />
              ) : null}
              {meta.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
