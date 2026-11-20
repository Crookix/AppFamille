'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Drama,
  Film,
  Gift,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Tv,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Input } from '@/components/ui/primitives';
import { ConfirmSheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { useHouseholdRealtime } from '@/components/providers/use-realtime';
import { RecoSheet } from '@/components/reco/reco-sheet';
import { RecipientPicker, type Recipient } from '@/components/reco/recipient-picker';
import {
  createRecommendationAction,
  deleteRecommendationAction,
  setRecommendationStatusAction,
} from '@/lib/actions/recommendations';
import {
  RECO_KINDS,
  countOpenByKind,
  formatRecoPrice,
  isGift,
  recoKind,
  recoStatusLabel,
  sortRecommendations,
} from '@/lib/recommendations';
import type { RecommendationWithWants } from '@/lib/data/recommendations';
import { cn } from '@/lib/utils';
import type { RecoKind } from '@/lib/database.types';

const KIND_ICONS: Record<RecoKind, React.ElementType> = {
  film: Film,
  serie: Tv,
  lecture: BookOpen,
  theatre: Drama,
  sortie: MapPin,
  cadeau: Gift,
  autre: Sparkles,
};

/**
 * Les envies du foyer, en deux niveaux très simples.
 *
 * 1. L'accueil : une grosse touche par genre (Films, Séries…), rien d'autre.
 * 2. Un genre ouvert : uniquement ses éléments, une ligne chacun — une case
 *    pour dire « vu », le titre, et c'est tout. Le détail (note, lien, auteur)
 *    reste à un appui de distance, dans la fiche, au lieu d'encombrer la liste.
 *
 * Le genre vit dans l'adresse (`/reco?genre=film`) : le bouton Retour du
 * téléphone ramène à l'accueil, et une liste se partage par son lien.
 */
export function RecoBoard({
  initial,
  kind,
}: {
  initial: RecommendationWithWants[];
  kind: RecoKind | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { household } = useHousehold();

  useHouseholdRealtime(household.id, ['recommendations', 'recommendation_wants']);

  const [recos, setRecos] = React.useState(initial);
  React.useEffect(() => setRecos(initial), [initial]);

  if (!kind) {
    return <Accueil recos={recos} onAdd={() => router.refresh()} />;
  }

  return (
    <Genre
      kind={kind}
      recos={recos}
      setRecos={setRecos}
      onError={(message) => toast.error(message)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Accueil : un bouton par genre                                              */
/* -------------------------------------------------------------------------- */

function Accueil({
  recos,
  onAdd,
}: {
  recos: RecommendationWithWants[];
  onAdd: () => void;
}) {
  const [creating, setCreating] = React.useState(false);
  const counts = React.useMemo(() => countOpenByKind(recos), [recos]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">Reco</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Ajouter
        </Button>
      </div>

      <ul className="grid grid-cols-2 gap-2.5">
        {RECO_KINDS.map(({ key, plural }) => {
          const Icon = KIND_ICONS[key];
          const count = counts[key];
          return (
            <li key={key}>
              <Link
                href={`/reco?genre=${key}`}
                className="flex min-h-24 flex-col justify-between rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-3.5 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className="flex items-center justify-between">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-[var(--accent-text)]"
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  {count > 0 ? (
                    <span className="text-sm font-bold text-muted">{count}</span>
                  ) : null}
                </span>
                <span className="mt-2 font-bold">{plural}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <RecoSheet
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={onAdd}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Un genre : la liste, rien que la liste                                     */
/* -------------------------------------------------------------------------- */

function Genre({
  kind,
  recos,
  setRecos,
  onError,
}: {
  kind: RecoKind;
  recos: RecommendationWithWants[];
  setRecos: React.Dispatch<React.SetStateAction<RecommendationWithWants[]>>;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const meta = recoKind(kind);

  const [title, setTitle] = React.useState('');
  // Pour une idée cadeau : le destinataire reste choisi d'un ajout au suivant,
  // car on note souvent plusieurs idées d'affilée pour la même personne.
  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [showDone, setShowDone] = React.useState(false);
  const [editing, setEditing] = React.useState<RecommendationWithWants | null>(null);
  const [deleting, setDeleting] = React.useState<RecommendationWithWants | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);

  const ofKind = React.useMemo(
    () => sortRecommendations(recos.filter((r) => r.kind === kind)),
    [recos, kind],
  );
  const open = ofKind.filter((r) => r.status !== 'fait');
  const done = ofKind.filter((r) => r.status === 'fait');

  async function add(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || adding) return;

    setAdding(true);
    const result = await createRecommendationAction({
      kind,
      title: trimmed,
      ...(isGift(kind)
        ? { recipientLabel: recipient?.label ?? null, recipientChildId: recipient?.childId ?? null }
        : {}),
    });
    setAdding(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }

    setTitle('');
    router.refresh();
  }

  async function toggleDone(reco: RecommendationWithWants) {
    const before = reco.status;
    const next = before === 'fait' ? 'idee' : 'fait';

    setRecos((current) => current.map((r) => (r.id === reco.id ? { ...r, status: next } : r)));

    const result = await setRecommendationStatusAction(reco.id, next);
    if (!result.ok) {
      setRecos((current) => current.map((r) => (r.id === reco.id ? { ...r, status: before } : r)));
      onError(result.error);
      return;
    }
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const result = await deleteRecommendationAction(deleting.id);
    setDeletePending(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }

    setRecos((current) => current.filter((r) => r.id !== deleting.id));
    setDeleting(null);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        <Link
          href="/reco"
          aria-label="Retour aux genres"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)]"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </Link>
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">{meta.plural}</h1>
      </div>

      <form onSubmit={add} className="mb-4 flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Ajouter : ${meta.titlePlaceholder}`}
          aria-label={`Ajouter à la liste « ${meta.plural} »`}
          maxLength={200}
          className="h-11 flex-1"
        />
        <Button type="submit" loading={adding} disabled={!title.trim()} aria-label="Ajouter">
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
      </form>

      {isGift(kind) ? (
        <div className="mb-4">
          <RecipientPicker value={recipient} onChange={setRecipient} />
        </div>
      ) : null}

      {open.length === 0 && done.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          Rien pour l’instant. Écrivez un titre ci-dessus pour commencer.
        </p>
      ) : (
        <>
          {open.length > 0 ? (
            <Card className="divide-y divide-[var(--line)] p-0">
              {open.map((reco) => (
                <Ligne
                  key={reco.id}
                  reco={reco}
                  onToggle={() => toggleDone(reco)}
                  onOpen={() => setEditing(reco)}
                  onDelete={() => setDeleting(reco)}
                />
              ))}
            </Card>
          ) : (
            <p className="py-6 text-center text-sm text-muted">Tout est fait. Bravo !</p>
          )}

          {done.length > 0 ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="flex h-11 w-full items-center gap-1.5 text-sm font-semibold text-muted"
              >
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', !showDone && '-rotate-90')}
                  aria-hidden
                />
                {recoStatusLabel(kind, 'fait')} ({done.length})
              </button>
              {showDone ? (
                <Card className="divide-y divide-[var(--line)] p-0">
                  {done.map((reco) => (
                    <Ligne
                      key={reco.id}
                      reco={reco}
                      onToggle={() => toggleDone(reco)}
                      onOpen={() => setEditing(reco)}
                      onDelete={() => setDeleting(reco)}
                    />
                  ))}
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <RecoSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        reco={editing}
      />
      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deletePending}
        title="Supprimer ?"
        description={
          deleting
            ? `« ${deleting.title} » disparaîtra pour tout le foyer. Cette action est définitive.`
            : ''
        }
      />
    </div>
  );
}

/** Une ligne : case, titre, corbeille. Un appui sur le titre ouvre la fiche. */
function Ligne({
  reco,
  onToggle,
  onOpen,
  onDelete,
}: {
  reco: RecommendationWithWants;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const done = reco.status === 'fait';
  const { children } = useHousehold();

  // « Pour Léa · anniversaire · 25 € » : ce qui fait d'une idée cadeau une idée
  // pour quelqu'un. Le prénom de l'enfant d'abord, le libellé saisi sinon.
  const recipient =
    children.find((c) => c.id === reco.recipient_child_id)?.first_name ?? reco.recipient_label;
  const details = isGift(reco.kind)
    ? [recipient ? `Pour ${recipient}` : null, reco.occasion, formatRecoPrice(reco.price)]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="flex items-center gap-1 pl-1 pr-1">
      <button
        type="button"
        onClick={onToggle}
        role="checkbox"
        aria-checked={done}
        aria-label={`${recoStatusLabel(reco.kind, 'fait')} : ${reco.title}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors',
            done
              ? 'border-transparent bg-sage-500 text-white'
              : 'border-[var(--line)] text-transparent',
          )}
        >
          <Check className="h-4 w-4" aria-hidden />
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-between gap-2 text-left font-semibold leading-snug',
          done && 'text-muted line-through',
        )}
      >
        <span className="min-w-0 py-1.5">
          <span className="block break-words">{reco.title}</span>
          {details ? (
            <span className="block text-[0.8125rem] font-normal text-[var(--accent-text)]">
              {details}
            </span>
          ) : null}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </button>

      <Button variant="ghost" size="iconSm" onClick={onDelete} aria-label={`Supprimer ${reco.title}`}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
