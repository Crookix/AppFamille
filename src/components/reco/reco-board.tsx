'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Drama,
  ExternalLink,
  Film,
  Gift,
  Heart,
  MapPin,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Tv,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Input } from '@/components/ui/primitives';
import { ConfirmSheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { Avatar } from '@/components/ui/avatar';
import { useHousehold } from '@/components/providers/household-provider';
import { useHouseholdRealtime } from '@/components/providers/use-realtime';
import { RecoSheet } from '@/components/reco/reco-sheet';
import {
  deleteRecommendationAction,
  setRecommendationStatusAction,
  toggleRecommendationWantAction,
} from '@/lib/actions/recommendations';
import {
  RECO_KINDS,
  countOpenByKind,
  formatRecoPrice,
  isGift,
  matchesRecoSearch,
  recoKind,
  recoStatusLabel,
  recoUrlHost,
  sortRecommendations,
} from '@/lib/recommendations';
import type { RecommendationWithWants } from '@/lib/data/recommendations';
import { cn } from '@/lib/utils';
import type { HouseholdMemberRow, RecoKind } from '@/lib/database.types';

const KIND_ICONS: Record<RecoKind, React.ElementType> = {
  film: Film,
  serie: Tv,
  lecture: BookOpen,
  theatre: Drama,
  sortie: MapPin,
  cadeau: Gift,
  autre: Sparkles,
};

type Tab = RecoKind | 'tout';

/**
 * Le mur des recommandations du foyer.
 *
 * Un seul écran pour les sept genres, filtré par onglets : ce que l'on cherche
 * un soir de semaine, c'est « qu'est-ce qu'on regarde », pas « ouvrons la
 * rubrique films ». Ce qui est déjà vu reste consultable, mais replié : une
 * liste où les envies se mêlent aux souvenirs ne sert plus à choisir.
 */
export function RecoBoard({ initial }: { initial: RecommendationWithWants[] }) {
  const router = useRouter();
  const toast = useToast();
  const { household, members, children, me } = useHousehold();

  useHouseholdRealtime(household.id, ['recommendations', 'recommendation_wants']);

  const [recos, setRecos] = React.useState(initial);
  const [tab, setTab] = React.useState<Tab>('tout');
  const [search, setSearch] = React.useState('');
  const [showDone, setShowDone] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<RecommendationWithWants | null>(null);
  const [deleting, setDeleting] = React.useState<RecommendationWithWants | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);

  React.useEffect(() => setRecos(initial), [initial]);

  const openCounts = React.useMemo(() => countOpenByKind(recos), [recos]);
  const doneCount = recos.filter((r) => r.status === 'fait').length;

  const visible = React.useMemo(() => {
    const filtered = recos.filter((reco) => {
      if (tab !== 'tout' && reco.kind !== tab) return false;
      if (!showDone && reco.status === 'fait') return false;
      return matchesRecoSearch(reco, search);
    });
    return sortRecommendations(filtered);
  }, [recos, tab, showDone, search]);

  /* ---- Envies ---------------------------------------------------------- */

  async function toggleWant(reco: RecommendationWithWants) {
    const wanted = reco.wants.includes(me.id);

    setRecos((current) =>
      current.map((r) =>
        r.id === reco.id
          ? {
              ...r,
              wants: wanted ? r.wants.filter((id) => id !== me.id) : [...r.wants, me.id],
            }
          : r,
      ),
    );

    const result = await toggleRecommendationWantAction(reco.id, !wanted);

    if (!result.ok) {
      setRecos((current) =>
        current.map((r) => (r.id === reco.id ? { ...r, wants: reco.wants } : r)),
      );
      toast.error(result.error);
      return;
    }

    router.refresh();
  }

  /* ---- États ----------------------------------------------------------- */

  async function setStatus(
    reco: RecommendationWithWants,
    status: 'idee' | 'en_cours' | 'fait',
  ) {
    const before = reco.status;

    setRecos((current) =>
      current.map((r) => (r.id === reco.id ? { ...r, status } : r)),
    );

    const result = await setRecommendationStatusAction(reco.id, status);

    if (!result.ok) {
      setRecos((current) =>
        current.map((r) => (r.id === reco.id ? { ...r, status: before } : r)),
      );
      toast.error(result.error);
      return;
    }

    if (status === 'fait') {
      toast.success(`${recoStatusLabel(reco.kind, 'fait')} — c'est noté.`, {
        label: 'Annuler',
        onClick: async () => {
          await setRecommendationStatusAction(reco.id, before);
          router.refresh();
        },
      });
    }
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const result = await deleteRecommendationAction(deleting.id);
    setDeletePending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setRecos((current) => current.filter((r) => r.id !== deleting.id));
    setDeleting(null);
    toast.success('Recommandation supprimée.');
    router.refresh();
  }

  /* ---- Rendu ----------------------------------------------------------- */

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'tout', label: 'Tout', count: Object.values(openCounts).reduce((a, b) => a + b, 0) },
    ...RECO_KINDS.map((k) => ({ key: k.key as Tab, label: k.plural, count: openCounts[k.key] })),
  ];

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Reco</h1>
          <p className="mt-0.5 text-sm text-muted">
            Ce que la famille se recommande : films, séries, lectures, sorties,
            idées cadeaux.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden />
          Ajouter
        </Button>
      </div>

      {/* Onglets : ils reviennent à la ligne plutôt que de défiler. Huit
          onglets ne tiennent pas sur une ligne à 375 px, et ce qui défile
          n'existe pas — un genre qu'il faut aller chercher hors de l'écran ne
          sera jamais ouvert. Quelques lignes de plus coûtent moins cher qu'une
          rubrique invisible. */}
      <div
        role="tablist"
        aria-label="Genre de recommandation"
        className="mb-3 flex flex-wrap gap-1.5"
      >
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
              tab === key
                ? 'bg-brand-500 text-white'
                : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
            )}
          >
            {label}
            {count > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.65rem] font-bold',
                  tab === key ? 'bg-white/25' : 'bg-[var(--bg-elevated)]',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {recos.length > 0 ? (
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher une recommandation"
              className="h-11 pl-10"
            />
          </div>
          {doneCount > 0 ? (
            <Button
              variant={showDone ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowDone((v) => !v)}
              aria-pressed={showDone}
              className="h-11 shrink-0"
            >
              Déjà fait
            </Button>
          ) : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" aria-hidden />}
          title={
            recos.length === 0
              ? 'Aucune reco pour l’instant'
              : search
                ? 'Rien ne correspond à cette recherche'
                : 'Rien à découvrir ici'
          }
          description={
            recos.length === 0
              ? 'Notez un film à voir, un livre, une sortie du dimanche ou une idée cadeau : tout le foyer la retrouvera ici.'
              : 'Changez d’onglet, ou affichez ce qui est déjà fait.'
          }
          action={
            recos.length === 0 ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Ajouter une reco
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((reco) => (
            <li key={reco.id}>
              <RecoCard
                reco={reco}
                meId={me.id}
                members={members}
                childName={
                  children.find((c) => c.id === reco.recipient_child_id)?.first_name ?? null
                }
                onWant={() => toggleWant(reco)}
                onStatus={(status) => setStatus(reco, status)}
                onEdit={() => setEditing(reco)}
                onDelete={() => setDeleting(reco)}
              />
            </li>
          ))}
        </ul>
      )}

      <RecoSheet
        open={creating}
        onClose={() => setCreating(false)}
        defaultKind={tab === 'tout' ? 'film' : tab}
      />
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
        title="Supprimer cette reco ?"
        description={
          deleting
            ? `« ${deleting.title} » disparaîtra pour tout le foyer. Cette action est définitive.`
            : ''
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Fiche                                                                      */
/* -------------------------------------------------------------------------- */

function RecoCard({
  reco,
  meId,
  members,
  childName,
  onWant,
  onStatus,
  onEdit,
  onDelete,
}: {
  reco: RecommendationWithWants;
  meId: string;
  members: HouseholdMemberRow[];
  childName: string | null;
  onWant: () => void;
  onStatus: (status: 'idee' | 'en_cours' | 'fait') => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = recoKind(reco.kind);
  const Icon = KIND_ICONS[reco.kind] ?? Sparkles;
  const done = reco.status === 'fait';
  const wanted = reco.wants.includes(meId);
  const host = recoUrlHost(reco.url);
  const price = formatRecoPrice(reco.price);
  const rating = reco.rating;
  const suggester = members.find((m) => m.id === reco.suggested_by) ?? null;
  const finisher = done ? (members.find((m) => m.id === reco.done_by) ?? null) : null;

  const recipient = childName ?? reco.recipient_label;
  const giftLine = isGift(reco.kind)
    ? [recipient ? `Pour ${recipient}` : null, reco.occasion, price].filter(Boolean).join(' · ')
    : null;

  return (
    <Card className={cn('p-3.5', done && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-white/5"
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('font-bold leading-snug', done && 'line-through')}>{reco.title}</p>
            <Badge tone={done ? 'sage' : reco.status === 'en_cours' ? 'honey' : 'neutral'}>
              {recoStatusLabel(reco.kind, reco.status)}
            </Badge>
          </div>

          <p className="mt-0.5 text-sm text-muted">
            <span className="font-semibold">{meta.label}</span>
            {reco.author ? ` · ${reco.author}` : ''}
          </p>

          {rating ? (
            <p className="mt-1 flex items-center gap-0.5" aria-label={`Noté ${rating} sur 5`}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={cn(
                    'h-3.5 w-3.5',
                    star <= rating ? 'fill-honey-500 text-honey-500' : 'text-[var(--line)]',
                  )}
                  aria-hidden
                />
              ))}
            </p>
          ) : null}

          {giftLine ? (
            <p className="mt-1 text-sm font-semibold text-brand-600">{giftLine}</p>
          ) : null}

          {reco.note ? (
            <p className="mt-1.5 whitespace-pre-line text-sm text-[var(--fg)]">{reco.note}</p>
          ) : null}

          {host ? (
            <a
              href={reco.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {host}
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2">
        <button
          type="button"
          onClick={onWant}
          aria-pressed={wanted}
          aria-label={wanted ? "Je n'ai plus envie" : "Moi aussi j'ai envie"}
          className={cn(
            'flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors',
            wanted
              ? 'bg-brand-100 text-brand-700'
              : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)]',
          )}
        >
          <Heart className={cn('h-4 w-4', wanted && 'fill-brand-500 text-brand-500')} aria-hidden />
          Envie
          {reco.wants.length > 0 ? <span>{reco.wants.length}</span> : null}
        </button>

        {/* Qui a envie : les avatars disent en un coup d'œil si l'on est seul
            à vouloir, ou si toute la maison attend. */}
        {reco.wants.length > 0 ? (
          <span className="flex -space-x-1.5" aria-hidden>
            {reco.wants.slice(0, 4).map((memberId) => {
              const member = members.find((m) => m.id === memberId);
              if (!member) return null;
              return (
                <Avatar
                  key={memberId}
                  name={member.display_name}
                  color={member.color}
                  size="xs"
                  ring
                />
              );
            })}
          </span>
        ) : null}

        <span className="flex-1" />

        {done ? (
          <Button variant="ghost" size="sm" onClick={() => onStatus('idee')}>
            <Undo2 className="h-4 w-4" aria-hidden />
            Reprendre
          </Button>
        ) : (
          <Button variant="sage" size="sm" onClick={() => onStatus('fait')}>
            {recoStatusLabel(reco.kind, 'fait')}
          </Button>
        )}

        <Button variant="ghost" size="iconSm" onClick={onEdit} aria-label="Modifier">
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="iconSm" onClick={onDelete} aria-label="Supprimer">
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {suggester ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Avatar
            name={suggester.display_name}
            color={suggester.color}
            size="xs"
          />
          <span>
            Recommandé par {suggester.id === meId ? 'vous' : suggester.display_name}
            {/* Qui a coché : utile quand deux parents tiennent la même liste. */}
            {finisher
              ? ` · ${recoStatusLabel(reco.kind, 'fait')} par ${
                  finisher.id === meId ? 'vous' : finisher.display_name
                }`
              : ''}
          </span>
        </p>
      ) : null}
    </Card>
  );
}
