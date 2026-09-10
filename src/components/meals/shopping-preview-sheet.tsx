'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Merge, ShoppingBasket } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { CheckCircle, ErrorNote, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  confirmMealShoppingAction,
  previewMealShoppingAction,
  type ShoppingPreviewLine,
} from '@/lib/actions/meals';
import { AISLE_LABELS, AISLE_ORDER, formatQuantity } from '@/lib/ingredients';
import type { ShopAisle } from '@/lib/database.types';

/**
 * Récapitulatif avant d'ajouter les ingrédients aux courses.
 *
 * Rien n'est écrit tant que l'on n'a pas validé : c'est l'écran où l'on
 * décoche ce que l'on a déjà à la maison. Les ingrédients identiques venus de
 * plusieurs repas sont déjà regroupés, et ce qui figure déjà sur la liste est
 * signalé plutôt qu'ajouté en double en silence.
 */
export function ShoppingPreviewSheet({
  open,
  onClose,
  mealIds,
  listId,
}: {
  open: boolean;
  onClose: () => void;
  mealIds: string[];
  listId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = React.useState(true);
  const [lines, setLines] = React.useState<ShoppingPreviewLine[]>([]);
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);
    setExcluded(new Set());

    let cancelled = false;
    (async () => {
      const result = await previewMealShoppingAction(mealIds, listId);
      if (cancelled) return;

      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setLines([]);
        return;
      }

      setLines(result.data.lines);
      // Ce qui est déjà sur la liste est décoché d'office : le cas le plus
      // fréquent est qu'on n'en a pas besoin deux fois.
      setExcluded(
        new Set(
          result.data.lines
            .map((line, index) => (line.alreadyInList ? index : -1))
            .filter((index) => index >= 0),
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mealIds, listId]);

  function toggle(index: number) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirm() {
    const retained = lines.filter((_, index) => !excluded.has(index));

    if (retained.length === 0) {
      setError('Sélectionnez au moins un ingrédient, ou fermez ce récapitulatif.');
      return;
    }

    setPending(true);
    setError(null);

    const result = await confirmMealShoppingAction({
      listId,
      mealIds,
      lines: retained.map((line) => ({
        label: line.label,
        quantity: line.quantity,
        unit: line.unit,
        aisle: line.aisle,
        sourceMealIds: line.sourceMealIds,
      })),
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(
      `${result.data.count} ingrédient${result.data.count > 1 ? 's' : ''} ajouté${
        result.data.count > 1 ? 's' : ''
      } aux courses.`,
    );
    onClose();
    router.refresh();
  }

  const byAisle = new Map<ShopAisle, { line: ShoppingPreviewLine; index: number }[]>();
  lines.forEach((line, index) => {
    const list = byAisle.get(line.aisle) ?? [];
    list.push({ line, index });
    byAisle.set(line.aisle, list);
  });

  const retainedCount = lines.length - excluded.size;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="large"
      title="Ajouter aux courses"
      description="Décochez ce que vous avez déjà à la maison."
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button
            className="flex-1"
            onClick={confirm}
            loading={pending}
            disabled={loading || retainedCount === 0}
          >
            <ShoppingBasket className="h-4 w-4" aria-hidden />
            Ajouter {retainedCount > 0 ? `(${retainedCount})` : ''}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error && lines.length === 0 ? (
        <ErrorNote>{error}</ErrorNote>
      ) : lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          Aucun ingrédient à ajouter pour ces repas.
        </p>
      ) : (
        <div className="space-y-4">
          {AISLE_ORDER.filter((aisle) => byAisle.has(aisle)).map((aisle) => (
            <section key={aisle}>
              <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted">
                {AISLE_LABELS[aisle]}
              </h3>
              <div className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
                {byAisle.get(aisle)!.map(({ line, index }) => (
                  <div key={index} className="flex items-center gap-1 pl-1 pr-3">
                    <CheckCircle
                      checked={!excluded.has(index)}
                      onChange={() => toggle(index)}
                      label={`${excluded.has(index) ? 'Ajouter' : 'Ne pas ajouter'} ${line.label}`}
                    />
                    <div className="min-w-0 flex-1 py-2">
                      <p className="truncate text-sm font-semibold">
                        {line.label}
                        {formatQuantity(line.quantity, line.unit) ? (
                          <span className="ml-2 font-normal text-muted">
                            {formatQuantity(line.quantity, line.unit)}
                          </span>
                        ) : null}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        {line.merged ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-sage-700">
                            <Merge className="h-3 w-3" aria-hidden />
                            regroupé
                          </span>
                        ) : null}
                        {line.alreadyInList ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-honey-700">
                            <AlertCircle className="h-3 w-3" aria-hidden />
                            déjà sur la liste
                          </span>
                        ) : null}
                        {line.sources.length > 0 ? (
                          <span className="truncate">{line.sources.join(' · ')}</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <p className="text-xs text-muted">
            Les articles que vous avez ajoutés à la main ne sont jamais retirés :
            seuls les ingrédients issus de ces mêmes repas sont remplacés.
          </p>
        </div>
      )}
    </Sheet>
  );
}
