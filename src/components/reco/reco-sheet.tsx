'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  createRecommendationAction,
  updateRecommendationAction,
} from '@/lib/actions/recommendations';
import { RECO_KINDS, isGift, recoKind } from '@/lib/recommendations';
import { RecipientPicker, type Recipient } from '@/components/reco/recipient-picker';
import { useHousehold } from '@/components/providers/household-provider';
import { cn } from '@/lib/utils';
import type { RecoKind, RecommendationRow } from '@/lib/database.types';

/**
 * Formulaire d'une recommandation : un titre, un petit mot, c'est tout.
 *
 * Le genre ne se choisit qu'à la création (en modification, on est déjà dans
 * la liste du genre). L'état « vu » se coche dans la liste ; la note, le lien,
 * l'auteur et le prix ne sont plus saisis ici. Seul le destinataire d'une idée
 * cadeau l'est : sans lui, une liste de cadeaux ne dit plus pour qui.
 *
 * En modification on n'envoie que le titre et le mot : l'action de mise à jour
 * ne touche pas aux champs absents, donc ce qui avait été saisi avant
 * (lien, note, prix d'un cadeau…) reste intact en base.
 */
export function RecoSheet({
  open,
  onClose,
  reco = null,
  defaultKind = 'film',
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  reco?: RecommendationRow | null;
  defaultKind?: RecoKind;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { children } = useHousehold();

  const isEditing = Boolean(reco);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<RecoKind>(defaultKind);
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [recipient, setRecipient] = React.useState<Recipient | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKind(reco?.kind ?? defaultKind);
    setTitle(reco?.title ?? '');
    setNote(reco?.note ?? '');
    // Le prénom de l'enfant d'abord (il suit un renommage), le libellé saisi sinon.
    const childName = children.find((c) => c.id === reco?.recipient_child_id)?.first_name;
    const label = childName ?? reco?.recipient_label ?? null;
    setRecipient(label ? { label, childId: reco?.recipient_child_id ?? null } : null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reco?.id, defaultKind]);

  const meta = recoKind(kind);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Donnez un titre.');
      return;
    }

    setPending(true);
    // Pour un cadeau, on envoie aussi le destinataire. À la modification on
    // renvoie l'occasion et le prix déjà saisis : l'action remet à zéro les
    // champs du cadeau qu'elle ne reçoit pas.
    const giftFields = isGift(kind)
      ? { recipientLabel: recipient?.label ?? null, recipientChildId: recipient?.childId ?? null }
      : {};
    const result = reco
      ? await updateRecommendationAction(reco.id, {
          title: title.trim(),
          note,
          ...giftFields,
          ...(isGift(kind) ? { occasion: reco.occasion, price: reco.price } : {}),
        })
      : await createRecommendationAction({ kind, title: title.trim(), note, ...giftFields });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? 'Modifié.' : 'Ajouté.');
    onSaved?.();
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEditing ? meta.label : 'Nouvelle reco'}
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
        {!isEditing ? (
          <div role="radiogroup" aria-label="Genre" className="flex flex-wrap gap-2">
            {RECO_KINDS.map((choice) => {
              const selected = kind === choice.key;
              return (
                <button
                  key={choice.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setKind(choice.key)}
                  className={cn(
                    'h-11 rounded-full border-2 px-4 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-transparent bg-brand-500 text-white'
                      : 'border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <Field label="Quoi ?" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={meta.titlePlaceholder}
            maxLength={200}
            required
            data-autofocus
          />
        </Field>

        {isGift(kind) ? <RecipientPicker value={recipient} onChange={setRecipient} /> : null}

        <Field label="Un mot" hint="facultatif">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Pourquoi, où, avec qui…"
            maxLength={2000}
            rows={2}
          />
        </Field>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
