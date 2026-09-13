'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useSupabase } from '@/components/providers/use-supabase';
import { useHousehold } from '@/components/providers/household-provider';
import { addShoppingItemAction } from '@/lib/actions/shopping';
import { AISLE_LABELS, AISLE_ORDER, guessAisle } from '@/lib/ingredients';
import type { FrequentItemRow, ShopAisle, ShoppingListRow } from '@/lib/database.types';

/**
 * Ajout rapide d'un ou plusieurs articles.
 *
 * La feuille ne se ferme pas après chaque ajout : on tape « pain », entrée,
 * « lait », entrée. C'est le geste réel devant le frigo, et il serait ruiné
 * par une fermeture à chaque article.
 */
export function QuickShoppingSheet({
  open,
  onClose,
  listId,
}: {
  open: boolean;
  onClose: () => void;
  listId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = useSupabase();
  const { household } = useHousehold();

  const [label, setLabel] = React.useState('');
  const [quantity, setQuantity] = React.useState('');
  const [unit, setUnit] = React.useState('');
  const [aisle, setAisle] = React.useState<ShopAisle | ''>('');
  const [targetList, setTargetList] = React.useState<string | null>(listId ?? null);
  const [lists, setLists] = React.useState<ShoppingListRow[]>([]);
  const [frequent, setFrequent] = React.useState<FrequentItemRow[]>([]);
  const [added, setAdded] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setLabel('');
    setQuantity('');
    setUnit('');
    setAisle('');
    setAdded([]);
    setError(null);
    setTargetList(listId ?? null);

    let cancelled = false;

    (async () => {
      const [listsResult, frequentResult] = await Promise.all([
        supabase
          .from('shopping_lists')
          .select('*')
          .eq('household_id', household.id)
          .order('is_default', { ascending: false })
          .order('created_at'),
        supabase
          .from('frequent_items')
          .select('*')
          .eq('household_id', household.id)
          .order('use_count', { ascending: false })
          .limit(12),
      ]);

      if (cancelled) return;
      setLists(listsResult.data ?? []);
      setFrequent(frequentResult.data ?? []);
      if (!listId && listsResult.data && listsResult.data.length > 0) {
        setTargetList(listsResult.data[0].id);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listId, household.id]);

  async function add(labelToAdd: string, unitToAdd?: string | null, aisleToAdd?: ShopAisle) {
    const trimmed = labelToAdd.trim();
    if (!trimmed) return;

    setPending(true);
    setError(null);

    const parsedQuantity = quantity.trim()
      ? Number(quantity.replace(',', '.'))
      : null;

    if (parsedQuantity !== null && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)) {
      setPending(false);
      setError('La quantité doit être un nombre positif.');
      return;
    }

    const result = await addShoppingItemAction({
      listId: targetList,
      label: trimmed,
      quantity: parsedQuantity,
      unit: unitToAdd ?? unit ?? null,
      aisle: aisleToAdd ?? (aisle || null),
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setAdded((current) => [trimmed, ...current].slice(0, 8));
    setLabel('');
    setQuantity('');
    setUnit('');
    setAisle('');
    inputRef.current?.focus();
    router.refresh();
  }

  function finish() {
    if (added.length > 0) {
      toast.success(
        added.length === 1 ? 'Article ajouté aux courses.' : `${added.length} articles ajoutés.`,
      );
    }
    onClose();
  }

  const suggestedAisle = label.trim() ? guessAisle(label) : null;

  return (
    <Sheet
      open={open}
      onClose={finish}
      title="Ajouter aux courses"
      footer={
        <div className="pb-1">
          <Button className="w-full" onClick={finish}>
            {added.length > 0 ? 'Terminé' : 'Fermer'}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(label);
        }}
        className="space-y-4"
      >
        <Field label="Article" required>
          <Input
            ref={inputRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Lait, pain, tomates…"
            maxLength={120}
            data-autofocus
            enterKeyHint="done"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantité" hint="facultatif">
            <Input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="2"
            />
          </Field>
          <Field label="Unité" hint="facultatif">
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="kg, L, pièce…"
              maxLength={30}
            />
          </Field>
        </div>

        <Field
          label="Rayon"
          hint={
            suggestedAisle && !aisle && suggestedAisle !== 'autre'
              ? `deviné : ${AISLE_LABELS[suggestedAisle]}`
              : undefined
          }
        >
          <Select value={aisle} onChange={(e) => setAisle(e.target.value as ShopAisle)}>
            <option value="">Deviner automatiquement</option>
            {AISLE_ORDER.map((key) => (
              <option key={key} value={key}>
                {AISLE_LABELS[key]}
              </option>
            ))}
          </Select>
        </Field>

        {lists.length > 1 ? (
          <Field label="Liste">
            <Select
              value={targetList ?? ''}
              onChange={(e) => setTargetList(e.target.value || null)}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Button type="submit" className="w-full" loading={pending} disabled={!label.trim()}>
          {pending ? null : <Plus className="h-4 w-4" aria-hidden />}
          Ajouter
        </Button>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>

      {added.length > 0 ? (
        <div className="mt-5 rounded-2xl bg-sage-100 px-3.5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-sage-700">
            <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
            Ajouté à la liste
          </p>
          <p className="text-sm text-sage-700">{added.join(' · ')}</p>
        </div>
      ) : null}

      {frequent.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold">Vos habitudes</p>
          <div className="flex flex-wrap gap-1.5">
            {frequent.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={pending}
                onClick={() => add(item.label, item.unit, item.aisle)}
                className="h-9 rounded-full bg-[var(--bg-subtle)] px-3.5 text-sm font-semibold text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
              >
                + {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
