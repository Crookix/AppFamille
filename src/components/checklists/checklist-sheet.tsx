'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  createChecklistAction,
  updateChecklistAction,
} from '@/lib/actions/checklists';
import { parseChecklistDraft } from '@/lib/checklists';
import type { ChecklistRow } from '@/lib/database.types';

/**
 * Création et renommage d'une check-list.
 *
 * À la création, le champ de contenu accepte une liste entière collée : on ne
 * saisit pas une valise ligne à ligne, on la reprend d'ailleurs. Le compte des
 * points reconnus s'affiche pendant la frappe, pour qu'on voie ce qui va être
 * créé avant de valider.
 */
export function ChecklistSheet({
  open,
  onClose,
  checklist = null,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  checklist?: ChecklistRow | null;
  /** Reçoit la liste qui vient d'être créée, pour l'ouvrir aussitôt. */
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const isEditing = Boolean(checklist);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [draft, setDraft] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setName(checklist?.name ?? '');
    setNote(checklist?.note ?? '');
    setDraft('');
    setError(null);
  }, [open, checklist]);

  const points = React.useMemo(() => parseChecklistDraft(draft), [draft]);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Donnez un nom à cette check-list.');
      return;
    }

    setPending(true);
    const result = checklist
      ? await updateChecklistAction(checklist.id, { name: name.trim(), note })
      : await createChecklistAction({ name: name.trim(), note, draft });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? 'Check-list modifiée.' : 'Check-list créée.');
    if (!checklist && result.data?.id) onCreated?.(result.data.id);
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEditing ? 'Modifier la check-list' : 'Nouvelle check-list'}
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} loading={pending}>
            {isEditing ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Nom" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="La valise des enfants"
            maxLength={80}
            required
            data-autofocus
          />
        </Field>

        <Field label="À quoi elle sert" hint="facultatif">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Pour un week-end chez les grands-parents."
            maxLength={500}
            rows={2}
          />
        </Field>

        {!isEditing ? (
          <Field
            label="Ce qu'elle contient"
            hint="une ligne par point — collez votre liste"
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={'Doudou\nPyjama\nBrosse à dents\nChaussons'}
              rows={7}
            />
          </Field>
        ) : null}

        {!isEditing && points.length > 0 ? (
          <p className="text-sm text-muted">
            {points.length} point{points.length > 1 ? 's' : ''} reconnu
            {points.length > 1 ? 's' : ''}. Les tirets et les numéros sont retirés.
          </p>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
