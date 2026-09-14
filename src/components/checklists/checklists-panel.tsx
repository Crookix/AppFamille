'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, ListTodo, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CheckCircle, EmptyState, Input } from '@/components/ui/primitives';
import { ConfirmSheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { useHouseholdRealtime } from '@/components/providers/use-realtime';
import { ChecklistSheet } from '@/components/checklists/checklist-sheet';
import {
  addChecklistItemsAction,
  deleteChecklistAction,
  deleteChecklistItemAction,
  resetChecklistAction,
  toggleChecklistItemAction,
} from '@/lib/actions/checklists';
import { checklistProgress } from '@/lib/checklists';
import type { ChecklistWithItems } from '@/lib/data/checklists';
import { formatRelativeDay, dayKey } from '@/lib/datetime';
import { cn } from '@/lib/utils';

/**
 * Les check-lists du foyer : les listes qu'on refait à l'identique.
 *
 * Chaque liste est repliée sur son avancement, et s'ouvre pour cocher. Le
 * bouton qui compte est « Remettre à zéro » : c'est lui qui distingue une
 * check-list d'une liste de courses, et il n'apparaît que lorsqu'il y a
 * quelque chose à décocher.
 */
export function ChecklistsPanel({ initial }: { initial: ChecklistWithItems[] }) {
  const router = useRouter();
  const toast = useToast();
  const { household, members } = useHousehold();

  useHouseholdRealtime(household.id, ['checklists', 'checklist_items']);

  const [listes, setListes] = React.useState(initial);
  const [ouverte, setOuverte] = React.useState<string | null>(initial[0]?.id ?? null);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<ChecklistWithItems | null>(null);
  const [deleting, setDeleting] = React.useState<ChecklistWithItems | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);

  React.useEffect(() => {
    setListes(initial);
    // On garde ouverte celle qu'on consultait si elle existe encore ; sinon on
    // ouvre la première. Sans cela, la liste qu'on vient de créer s'afficherait
    // repliée, et il faudrait un appui de plus pour voir ce qu'on a saisi.
    setOuverte((actuelle) =>
      actuelle && initial.some((l) => l.id === actuelle)
        ? actuelle
        : (initial[0]?.id ?? null),
    );
  }, [initial]);

  async function toggle(listeId: string, itemId: string, checked: boolean) {
    setListes((current) =>
      current.map((l) =>
        l.id === listeId
          ? {
              ...l,
              items: l.items.map((i) => (i.id === itemId ? { ...i, is_checked: checked } : i)),
            }
          : l,
      ),
    );

    const result = await toggleChecklistItemAction(itemId, checked);
    if (!result.ok) {
      setListes((current) =>
        current.map((l) =>
          l.id === listeId
            ? {
                ...l,
                items: l.items.map((i) =>
                  i.id === itemId ? { ...i, is_checked: !checked } : i,
                ),
              }
            : l,
        ),
      );
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function reset(liste: ChecklistWithItems) {
    const avant = liste.items;

    setListes((current) =>
      current.map((l) =>
        l.id === liste.id
          ? { ...l, items: l.items.map((i) => ({ ...i, is_checked: false })) }
          : l,
      ),
    );

    const result = await resetChecklistAction(liste.id);
    if (!result.ok) {
      setListes((current) =>
        current.map((l) => (l.id === liste.id ? { ...l, items: avant } : l)),
      );
      toast.error(result.error);
      return;
    }

    toast.success(`« ${liste.name} » est repartie à zéro.`);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const result = await deleteChecklistAction(deleting.id);
    setDeletePending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setListes((current) => current.filter((l) => l.id !== deleting.id));
    setDeleting(null);
    toast.success('Check-list supprimée.');
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm text-muted">
          Les listes qu'on refait à l'identique : on coche, puis on remet à zéro
          pour la fois suivante.
        </p>
        <Button size="sm" onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden />
          Nouvelle
        </Button>
      </div>

      {listes.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="h-6 w-6" aria-hidden />}
          title="Aucune check-list"
          description="La valise des enfants, le sac de piscine, ce qu'on emporte chez la nounou : ce qui se refait à chaque fois se note ici une seule fois."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Créer une check-list
            </Button>
          }
          className="surface"
        />
      ) : (
        <ul className="space-y-2.5">
          {listes.map((liste) => (
            <li key={liste.id}>
              <ChecklistCard
                liste={liste}
                ouverte={ouverte === liste.id}
                onOuvrir={() => setOuverte(ouverte === liste.id ? null : liste.id)}
                onToggle={(itemId, checked) => toggle(liste.id, itemId, checked)}
                onReset={() => reset(liste)}
                onEdit={() => setEditing(liste)}
                onDelete={() => setDeleting(liste)}
                membres={members}
                timezone={household.timezone}
              />
            </li>
          ))}
        </ul>
      )}

      <ChecklistSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => setOuverte(id)}
      />
      <ChecklistSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        checklist={editing}
      />
      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deletePending}
        title="Supprimer cette check-list ?"
        description={
          deleting
            ? `« ${deleting.name} » et ses ${deleting.items.length} point(s) disparaîtront pour tout le foyer. Cette action est définitive.`
            : ''
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Une check-list                                                             */
/* -------------------------------------------------------------------------- */

function ChecklistCard({
  liste,
  ouverte,
  onOuvrir,
  onToggle,
  onReset,
  onEdit,
  onDelete,
  membres,
  timezone,
}: {
  liste: ChecklistWithItems;
  ouverte: boolean;
  onOuvrir: () => void;
  onToggle: (itemId: string, checked: boolean) => void;
  onReset: () => void;
  onEdit: () => void;
  onDelete: () => void;
  membres: { id: string; display_name: string }[];
  timezone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const avancement = checklistProgress(liste.items);

  const [ajout, setAjout] = React.useState('');
  const [ajoutPending, setAjoutPending] = React.useState(false);

  async function ajouter(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!ajout.trim()) return;

    setAjoutPending(true);
    const result = await addChecklistItemsAction(liste.id, ajout);
    setAjoutPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAjout('');
    router.refresh();
  }

  async function retirer(itemId: string) {
    const result = await deleteChecklistItemAction(itemId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  const remisePar = liste.last_reset_by
    ? (membres.find((m) => m.id === liste.last_reset_by)?.display_name ?? null)
    : null;

  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <button
          type="button"
          onClick={onOuvrir}
          aria-expanded={ouverte}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="text-muted" aria-hidden>
            {ouverte ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-bold">{liste.name}</span>
              {avancement.complete ? <Badge tone="sage">Prête</Badge> : null}
            </span>
            <span className="mt-0.5 block text-sm text-muted">
              {avancement.total === 0
                ? 'Vide pour l’instant'
                : `${avancement.coches} sur ${avancement.total}`}
              {liste.last_reset_at
                ? ` · remise à zéro ${formatRelativeDay(dayKey(liste.last_reset_at, timezone), timezone)}${
                    remisePar ? ` par ${remisePar}` : ''
                  }`
                : ''}
            </span>
          </span>
        </button>

        {/* La jauge dit d'un coup d'œil s'il reste à faire, sans ouvrir. */}
        {avancement.total > 0 ? (
          <span
            className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--bg-subtle)] sm:block"
            aria-hidden
          >
            <span
              className={cn(
                'block h-full rounded-full transition-all',
                avancement.complete ? 'bg-sage-500' : 'bg-brand-500',
              )}
              style={{ width: `${Math.round(avancement.ratio * 100)}%` }}
            />
          </span>
        ) : null}
      </div>

      {ouverte ? (
        <div className="border-t border-[var(--line)] px-3.5 pb-3.5 pt-2">
          {liste.note ? (
            <p className="mb-2 text-sm text-muted">{liste.note}</p>
          ) : null}

          {liste.items.length > 0 ? (
            <ul className="mb-2">
              {liste.items.map((item) => (
                <li key={item.id} className="group flex items-center gap-1">
                  <CheckCircle
                    checked={item.is_checked}
                    onChange={(next) => onToggle(item.id, next)}
                    label={`${item.is_checked ? 'Décocher' : 'Cocher'} ${item.label}`}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 py-1 text-[0.95rem]',
                      item.is_checked && 'text-muted line-through',
                    )}
                  >
                    {item.label}
                  </span>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => retirer(item.id)}
                    aria-label={`Retirer ${item.label}`}
                    className="shrink-0 text-muted"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-sm text-muted">
              Rien encore. Ajoutez les points ci-dessous — une ligne chacun.
            </p>
          )}

          <form onSubmit={ajouter} className="flex gap-2">
            <Input
              value={ajout}
              onChange={(e) => setAjout(e.target.value)}
              placeholder="Ajouter un point…"
              aria-label={`Ajouter un point à ${liste.name}`}
              maxLength={120}
              className="h-11"
            />
            <Button
              type="submit"
              variant="outline"
              className="h-11 shrink-0"
              loading={ajoutPending}
              disabled={!ajout.trim()}
            >
              Ajouter
            </Button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2.5">
            {/* Rien à décocher, rien à remettre à zéro : le bouton ne se
                propose que lorsqu'il ferait quelque chose. */}
            {!avancement.vierge ? (
              <Button variant="secondary" size="sm" onClick={onReset}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Remettre à zéro
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button variant="ghost" size="iconSm" onClick={onEdit} aria-label="Modifier">
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="iconSm" onClick={onDelete} aria-label="Supprimer">
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
