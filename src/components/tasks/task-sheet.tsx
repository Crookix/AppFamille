'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { RecurrencePicker } from '@/components/events/pickers';
import { Avatar } from '@/components/ui/avatar';
import { createTaskAction, updateTaskAction } from '@/lib/actions/tasks';
import { cn, colorHex } from '@/lib/utils';
import { addDays, todayIn } from '@/lib/datetime';
import type { TaskRow } from '@/lib/database.types';

const PRIORITIES = [
  { value: 'basse', label: 'Basse' },
  { value: 'normale', label: 'Normale' },
  { value: 'haute', label: 'Haute' },
] as const;

/**
 * Formulaire de tâche.
 *
 * L'attribution est le geste central : elle se fait d'un appui sur un avatar,
 * sans ouvrir de liste déroulante. Le reste est replié par défaut.
 */
export function TaskSheet({
  open,
  onClose,
  task = null,
  defaultAssigneeId,
  defaultDueDate,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  task?: TaskRow | null;
  defaultAssigneeId?: string | null;
  defaultDueDate?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { household, members, children, me } = useHousehold();

  const isEditing = Boolean(task);
  const today = todayIn(household.timezone);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showMore, setShowMore] = React.useState(false);

  const [title, setTitle] = React.useState('');
  const [assignee, setAssignee] = React.useState<string | null>(null);
  const [dueDate, setDueDate] = React.useState('');
  const [priority, setPriority] = React.useState<'basse' | 'normale' | 'haute'>('normale');
  const [description, setDescription] = React.useState('');
  const [childId, setChildId] = React.useState<string | null>(null);
  const [recurrence, setRecurrence] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;

    if (task) {
      setTitle(task.title);
      setAssignee(task.assignee_id);
      setDueDate(task.due_date ?? '');
      setPriority(task.priority);
      setDescription(task.description ?? '');
      setChildId(task.child_id);
      setRecurrence(task.recurrence_rule);
      setShowMore(Boolean(task.description || task.child_id || task.recurrence_rule));
    } else {
      setTitle('');
      setAssignee(defaultAssigneeId ?? null);
      setDueDate(defaultDueDate ?? '');
      setPriority('normale');
      setDescription('');
      setChildId(null);
      setRecurrence(null);
      setShowMore(false);
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Donnez un titre à cette tâche.');
      return;
    }

    setPending(true);

    const payload = {
      title: title.trim(),
      description,
      assigneeId: assignee,
      dueDate: dueDate || null,
      priority,
      childId,
      recurrenceRule: recurrence,
    };

    const result = task
      ? await updateTaskAction(task.id, payload)
      : await createTaskAction(payload);

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? 'Tâche modifiée.' : 'Tâche ajoutée.');
    onSaved?.();
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEditing ? 'Modifier la tâche' : 'Nouvelle tâche'}
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} loading={pending}>
            {isEditing ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Quoi ?" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Prendre rendez-vous chez le dentiste"
            maxLength={200}
            required
            data-autofocus
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Qui s'en occupe ?</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={assignee === null}
              onClick={() => setAssignee(null)}
              className={cn(
                'h-10 rounded-full border-2 px-4 text-sm font-semibold transition-colors',
                assignee === null
                  ? 'border-transparent bg-[var(--fg)] text-[var(--bg-elevated)]'
                  : 'border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
              )}
            >
              Personne
            </button>
            {members.map((member) => {
              const selected = assignee === member.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAssignee(member.id)}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-full border-2 pl-1 pr-3.5 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-transparent text-white'
                      : 'border-[var(--line)] text-[var(--fg)] hover:bg-[var(--bg-subtle)]',
                  )}
                  style={selected ? { backgroundColor: colorHex(member.color) } : undefined}
                >
                  <Avatar name={member.display_name} color={member.color} size="sm" />
                  {member.display_name}
                  {member.id === me.id ? ' (moi)' : ''}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <span className="mb-2 block text-sm font-semibold">Pour quand ?</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              { label: "Aujourd'hui", value: today },
              { label: 'Demain', value: addDays(today, 1) },
              { label: 'Ce week-end', value: nextSaturday(today) },
              { label: 'Sans date', value: '' },
            ].map((choice) => (
              <button
                key={choice.label}
                type="button"
                onClick={() => setDueDate(choice.value)}
                className={cn(
                  'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
                  dueDate === choice.value
                    ? 'bg-brand-500 text-white'
                    : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Date d'échéance"
          />
        </div>

        {!showMore ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setShowMore(true)}
          >
            Priorité, enfant, répétition, notes…
          </Button>
        ) : (
          <div className="space-y-5 border-t border-[var(--line)] pt-5">
            <Field label="Priorité">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            {children.length > 0 ? (
              <Field label="Concerne un enfant" hint="facultatif">
                <Select
                  value={childId ?? ''}
                  onChange={(e) => setChildId(e.target.value || null)}
                >
                  <option value="">Aucun</option>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.first_name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <div className="rounded-2xl border border-[var(--line)] p-3.5">
              <p className="mb-2 text-sm font-semibold">Tâche récurrente</p>
              <p className="mb-3 text-xs text-muted">
                Une fois cochée, elle réapparaîtra à l'échéance suivante.
              </p>
              <RecurrencePicker rule={recurrence} onChange={setRecurrence} />
            </div>

            <Field label="Notes">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
          </div>
        )}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}

/** Prochain samedi (aujourd'hui compris s'il tombe un samedi). */
function nextSaturday(from: string): string {
  const date = new Date(`${from}T00:00:00Z`);
  const shift = (6 - date.getUTCDay() + 7) % 7;
  return addDays(from, shift);
}
