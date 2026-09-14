'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import {
  createRecommendationAction,
  updateRecommendationAction,
} from '@/lib/actions/recommendations';
import {
  RECO_KINDS,
  isGift,
  parseRecoPrice,
  recoKind,
  recoStatusLabel,
} from '@/lib/recommendations';
import { cn } from '@/lib/utils';
import type { RecoKind, RecoStatus, RecommendationRow } from '@/lib/database.types';

/**
 * Formulaire d'une recommandation.
 *
 * Le genre se choisit en premier, parce qu'il commande le reste : le libellé
 * du second champ change, et les champs du cadeau n'apparaissent que pour un
 * cadeau. Poser la question dans l'autre sens obligerait à afficher en
 * permanence « destinataire » et « prix » à quelqu'un qui note un film.
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
  const [showMore, setShowMore] = React.useState(false);

  const [kind, setKind] = React.useState<RecoKind>(defaultKind);
  const [status, setStatus] = React.useState<RecoStatus>('idee');
  const [title, setTitle] = React.useState('');
  const [author, setAuthor] = React.useState('');
  const [note, setNote] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [rating, setRating] = React.useState<number | null>(null);
  const [recipientLabel, setRecipientLabel] = React.useState('');
  const [recipientChildId, setRecipientChildId] = React.useState<string | null>(null);
  const [occasion, setOccasion] = React.useState('');
  const [price, setPrice] = React.useState('');

  React.useEffect(() => {
    if (!open) return;

    if (reco) {
      setKind(reco.kind);
      setStatus(reco.status);
      setTitle(reco.title);
      setAuthor(reco.author ?? '');
      setNote(reco.note ?? '');
      setUrl(reco.url ?? '');
      setRating(reco.rating);
      setRecipientLabel(reco.recipient_label ?? '');
      setRecipientChildId(reco.recipient_child_id);
      setOccasion(reco.occasion ?? '');
      setPrice(reco.price === null ? '' : String(reco.price).replace('.', ','));
      setShowMore(Boolean(reco.url || reco.rating || reco.author));
    } else {
      setKind(defaultKind);
      setStatus('idee');
      setTitle('');
      setAuthor('');
      setNote('');
      setUrl('');
      setRating(null);
      setRecipientLabel('');
      setRecipientChildId(null);
      setOccasion('');
      setPrice('');
      setShowMore(false);
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reco?.id, defaultKind]);

  const meta = recoKind(kind);
  const gift = isGift(kind);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Donnez un titre à cette recommandation.');
      return;
    }

    setPending(true);

    const payload = {
      kind,
      status,
      title: title.trim(),
      author,
      note,
      url,
      rating,
      recipientLabel,
      recipientChildId,
      occasion,
      price: parseRecoPrice(price),
    };

    const result = reco
      ? await updateRecommendationAction(reco.id, payload)
      : await createRecommendationAction(payload);

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? 'Recommandation modifiée.' : 'Recommandation ajoutée.');
    onSaved?.();
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEditing ? 'Modifier la reco' : 'Nouvelle reco'}
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
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">De quoi s'agit-il ?</legend>
          <div className="flex flex-wrap gap-2">
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
        </fieldset>

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

        <Field label="Pourquoi vous le recommandez" hint="facultatif">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Un mot pour donner envie…"
            maxLength={2000}
            rows={2}
          />
        </Field>

        {gift ? (
          <div className="space-y-5 rounded-2xl border border-[var(--line)] p-3.5">
            <p className="text-sm font-semibold">Pour qui ?</p>

            {children.length > 0 ? (
              <Field label="Un enfant du foyer" hint="facultatif">
                <Select
                  value={recipientChildId ?? ''}
                  onChange={(e) => setRecipientChildId(e.target.value || null)}
                >
                  <option value="">Quelqu'un d'autre</option>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.first_name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {!recipientChildId ? (
              <Field label="Destinataire" hint="facultatif">
                <Input
                  value={recipientLabel}
                  onChange={(e) => setRecipientLabel(e.target.value)}
                  placeholder="Mamie, un ami de Léa…"
                  maxLength={80}
                />
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Occasion" hint="facultatif">
                <Input
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  placeholder="Noël"
                  maxLength={80}
                />
              </Field>
              <Field label="Prix" hint="facultatif">
                <Input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="25,00"
                  inputMode="decimal"
                  maxLength={12}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {isEditing ? (
          <Field label="Où en êtes-vous ?">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as RecoStatus)}
            >
              <option value="idee">{recoStatusLabel(kind, 'idee')}</option>
              <option value="en_cours">{recoStatusLabel(kind, 'en_cours')}</option>
              <option value="fait">{recoStatusLabel(kind, 'fait')}</option>
            </Select>
          </Field>
        ) : null}

        {!showMore ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setShowMore(true)}
          >
            {meta.authorLabel}, lien, note…
          </Button>
        ) : (
          <div className="space-y-5 border-t border-[var(--line)] pt-5">
            <Field label={meta.authorLabel} hint="facultatif">
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={meta.authorPlaceholder}
                maxLength={120}
              />
            </Field>

            <Field label="Lien" hint="facultatif">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="allocine.fr/film/…"
                inputMode="url"
                maxLength={2000}
              />
            </Field>

            <RatingPicker value={rating} onChange={setRating} />
          </div>
        )}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}

/**
 * Note sur cinq étoiles.
 *
 * Appuyer une seconde fois sur l'étoile déjà choisie efface la note : sans
 * cela, une note posée par erreur serait impossible à retirer, puisqu'il n'y a
 * pas de « zéro étoile » à viser.
 */
function RatingPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div>
      <span className="mb-2 block text-sm font-semibold">
        Votre note <span className="text-xs font-normal text-muted">facultatif</span>
      </span>
      <div className="flex items-center gap-1" role="group" aria-label="Note sur cinq">
        {[1, 2, 3, 4, 5].map((star) => {
          const active = (value ?? 0) >= star;
          return (
            <button
              key={star}
              type="button"
              aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
              aria-pressed={active}
              onClick={() => onChange(value === star ? null : star)}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-subtle)]"
            >
              <Star
                className={cn(
                  'h-5 w-5',
                  active ? 'fill-honey-500 text-honey-500' : 'text-[var(--line)]',
                )}
                aria-hidden
              />
            </button>
          );
        })}
        {value !== null ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-1 text-sm font-semibold text-muted hover:text-[var(--fg)]"
          >
            Effacer
          </button>
        ) : null}
      </div>
    </div>
  );
}
