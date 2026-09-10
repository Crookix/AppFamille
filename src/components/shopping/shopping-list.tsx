'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eraser, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CheckCircle, EmptyState, Select } from '@/components/ui/primitives';
import { ConfirmSheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { useHousehold } from '@/components/providers/household-provider';
import { QuickShoppingSheet } from '@/components/shopping/quick-shopping-sheet';
import {
  clearCheckedItemsAction,
  deleteShoppingItemAction,
  toggleShoppingItemAction,
} from '@/lib/actions/shopping';
import { AISLE_LABELS, AISLE_ORDER, formatQuantity } from '@/lib/ingredients';
import { cn } from '@/lib/utils';
import type { ShopAisle, ShoppingItemRow, ShoppingListRow } from '@/lib/database.types';

/**
 * Liste de courses partagée.
 *
 * Deux adultes peuvent être dans le même magasin : la liste s'actualise en
 * direct, sans rechargement. Ce qui est acheté descend en bas plutôt que de
 * disparaître, pour qu'on puisse décocher une erreur.
 */
export function ShoppingList({
  initialItems,
  lists,
  activeListId,
}: {
  initialItems: ShoppingItemRow[];
  lists: ShoppingListRow[];
  activeListId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();
  const { household, members } = useHousehold();

  const [items, setItems] = React.useState(initialItems);
  const [adding, setAdding] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<ShoppingItemRow | null>(null);
  const [clearing, setClearing] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);

  React.useEffect(() => setItems(initialItems), [initialItems]);

  /* Temps réel : la RLS s'applique aussi au flux, un autre foyer ne reçoit
     rien. On ne garde que les lignes de la liste affichée. */
  React.useEffect(() => {
    const channel = supabase
      .channel(`courses-${activeListId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shopping_items',
          filter: `list_id=eq.${activeListId}`,
        },
        (payload) => {
          setItems((current) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as ShoppingItemRow;
              return current.some((i) => i.id === row.id) ? current : [...current, row];
            }
            if (payload.eventType === 'UPDATE') {
              const row = payload.new as ShoppingItemRow;
              return current.map((i) => (i.id === row.id ? row : i));
            }
            if (payload.eventType === 'DELETE') {
              const row = payload.old as { id: string };
              return current.filter((i) => i.id !== row.id);
            }
            return current;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, activeListId]);

  async function toggle(item: ShoppingItemRow) {
    const next = !item.is_checked;

    // Bascule immédiate : cocher un article en rayon ne doit pas attendre
    // l'aller-retour réseau.
    setItems((current) =>
      current.map((i) => (i.id === item.id ? { ...i, is_checked: next } : i)),
    );

    const result = await toggleShoppingItemAction(item.id, next);

    if (!result.ok) {
      setItems((current) =>
        current.map((i) => (i.id === item.id ? { ...i, is_checked: !next } : i)),
      );
      toast.error(result.error);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const result = await deleteShoppingItemAction(toDelete.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setItems((current) => current.filter((i) => i.id !== toDelete.id));
    setToDelete(null);
  }

  async function clearChecked() {
    setClearing(true);
    const result = await clearCheckedItemsAction(activeListId);
    setClearing(false);
    setConfirmClear(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setItems((current) => current.filter((i) => !i.is_checked));
    toast.success('Articles achetés retirés.');
  }

  function switchList(listId: string) {
    router.push(`/listes?onglet=courses&liste=${listId}`);
  }

  const open = items.filter((i) => !i.is_checked);
  const done = items.filter((i) => i.is_checked);

  const byAisle = new Map<ShopAisle, ShoppingItemRow[]>();
  for (const item of open) {
    const list = byAisle.get(item.aisle) ?? [];
    list.push(item);
    byAisle.set(item.aisle, list);
  }

  return (
    <div className="space-y-4">
      {lists.length > 1 ? (
        <Select
          value={activeListId}
          onChange={(e) => switchList(e.target.value)}
          aria-label="Liste de courses"
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </Select>
      ) : null}

      <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        Ajouter un article
      </Button>

      {open.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<ShoppingBasket className="h-7 w-7" aria-hidden />}
          title="La liste est vide"
          description="Ajoutez ce qui manque, ou générez les courses depuis les repas de la semaine."
          className="surface"
        />
      ) : null}

      {AISLE_ORDER.filter((aisle) => byAisle.has(aisle)).map((aisle) => (
        <section key={aisle}>
          <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            {AISLE_LABELS[aisle]}
          </h3>
          <Card className="divide-y divide-[var(--line)] p-0">
            {byAisle.get(aisle)!.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => toggle(item)}
                onDelete={() => setToDelete(item)}
                members={members}
              />
            ))}
          </Card>
        </section>
      ))}

      {done.length > 0 ? (
        <section>
          <div className="mb-1.5 flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
              Dans le panier ({done.length})
            </h3>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 underline underline-offset-2"
            >
              <Eraser className="h-3 w-3" aria-hidden />
              Vider
            </button>
          </div>
          <Card className="divide-y divide-[var(--line)] p-0 opacity-60">
            {done.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => toggle(item)}
                onDelete={() => setToDelete(item)}
                members={members}
              />
            ))}
          </Card>
        </section>
      ) : null}

      <QuickShoppingSheet
        open={adding}
        onClose={() => setAdding(false)}
        listId={activeListId}
      />

      <ConfirmSheet
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Retirer cet article ?"
        description={`« ${toDelete?.label ?? ''} » sera retiré de la liste.`}
        confirmLabel="Retirer"
      />

      <ConfirmSheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearChecked}
        loading={clearing}
        title="Vider le panier ?"
        description={`${done.length} article(s) acheté(s) seront retirés de la liste. Les articles non cochés restent.`}
        confirmLabel="Vider"
      />
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onDelete,
  members,
}: {
  item: ShoppingItemRow;
  onToggle: () => void;
  onDelete: () => void;
  members: { id: string; display_name: string }[];
}) {
  const checkedBy = item.checked_by
    ? members.find((m) => m.id === item.checked_by)
    : null;
  const quantity = formatQuantity(item.quantity, item.unit);

  return (
    <div className="flex items-center gap-1 py-0.5 pl-1 pr-2">
      <CheckCircle
        checked={item.is_checked}
        onChange={onToggle}
        label={`${item.is_checked ? 'Décocher' : 'Cocher'} ${item.label}`}
      />
      <div className="min-w-0 flex-1 py-1.5">
        <p
          className={cn(
            'truncate text-sm font-semibold',
            item.is_checked && 'line-through',
          )}
        >
          {item.label}
          {quantity ? (
            <span className="ml-2 font-normal text-muted">{quantity}</span>
          ) : null}
        </p>
        {item.note || item.source === 'repas' || checkedBy ? (
          <p className="truncate text-xs text-muted">
            {item.note ? item.note : null}
            {item.note && item.source === 'repas' ? ' · ' : null}
            {item.source === 'repas' ? 'depuis les repas' : null}
            {checkedBy ? (
              <>
                {item.note || item.source === 'repas' ? ' · ' : null}
                <Check className="inline h-3 w-3" aria-hidden /> {checkedBy.display_name}
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="iconSm"
        onClick={onDelete}
        aria-label={`Retirer ${item.label}`}
      >
        <Trash2 className="h-4 w-4 text-muted" aria-hidden />
      </Button>
    </div>
  );
}
