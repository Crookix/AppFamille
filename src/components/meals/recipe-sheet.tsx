'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { deleteRecipeAction, saveRecipeAction } from '@/lib/actions/meals';
import { AISLE_LABELS, AISLE_ORDER, guessAisle } from '@/lib/ingredients';
import { cn } from '@/lib/utils';
import type { RecipeIngredientRow, RecipeRow, ShopAisle } from '@/lib/database.types';

type DraftIngredient = {
  key: string;
  label: string;
  quantity: string;
  unit: string;
  aisle: ShopAisle | '';
};

function emptyIngredient(): DraftIngredient {
  return {
    key: `i${Math.random().toString(36).slice(2, 9)}`,
    label: '',
    quantity: '',
    unit: '',
    aisle: '',
  };
}

/**
 * Fiche recette.
 *
 * Les quantités sont saisies POUR le nombre de portions indiqué : c'est ce
 * rapport qui permet ensuite d'ajuster les courses au nombre de convives
 * réellement présents.
 */
export function RecipeSheet({
  open,
  onClose,
  recipe,
  initialIngredients,
}: {
  open: boolean;
  onClose: () => void;
  recipe?: RecipeRow | null;
  initialIngredients?: RecipeIngredientRow[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = React.useState(recipe?.name ?? '');
  const [servings, setServings] = React.useState(String(recipe?.servings ?? 4));
  const [sourceUrl, setSourceUrl] = React.useState(recipe?.source_url ?? '');
  const [steps, setSteps] = React.useState(recipe?.steps ?? '');
  const [notes, setNotes] = React.useState(recipe?.notes ?? '');
  const [isFavorite, setIsFavorite] = React.useState(recipe?.is_favorite ?? false);
  const [ingredients, setIngredients] = React.useState<DraftIngredient[]>(() =>
    initialIngredients?.length
      ? initialIngredients.map((row) => ({
          key: row.id,
          label: row.label,
          quantity: row.quantity !== null ? String(row.quantity) : '',
          unit: row.unit ?? '',
          aisle: row.aisle,
        }))
      : [emptyIngredient()],
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  function update(key: string, patch: Partial<DraftIngredient>) {
    setIngredients((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Donnez un nom à la recette.');
      return;
    }

    const filled = ingredients.filter((i) => i.label.trim());

    for (const item of filled) {
      if (item.quantity.trim()) {
        const value = Number(item.quantity.replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0) {
          setError(`Quantité invalide pour « ${item.label} ».`);
          return;
        }
      }
    }

    setPending(true);

    const result = await saveRecipeAction(
      {
        name: name.trim(),
        servings: Number(servings) || 4,
        steps,
        notes,
        sourceUrl,
        isFavorite,
        ingredients: filled.map((item) => ({
          label: item.label.trim(),
          quantity: item.quantity.trim() ? Number(item.quantity.replace(',', '.')) : null,
          unit: item.unit.trim() || null,
          aisle: item.aisle || null,
        })),
      },
      recipe?.id,
    );

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(recipe ? 'Recette modifiée.' : 'Recette enregistrée.');
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!recipe) return;
    setPending(true);
    const result = await deleteRecipeAction(recipe.id);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Recette supprimée.');
    onClose();
    router.replace('/recettes');
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="large"
      title={recipe ? 'Modifier la recette' : 'Nouvelle recette'}
      footer={
        confirmingDelete ? (
          <div className="pb-1">
            <p className="mb-3 text-sm text-muted">
              La recette sera supprimée. Les repas qui l'utilisaient gardent leur intitulé.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmingDelete(false)}
              >
                Annuler
              </Button>
              <Button variant="danger" className="flex-1" onClick={remove} loading={pending}>
                Supprimer
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pb-1">
            {recipe ? (
              <Button
                variant="outline"
                size="icon"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Supprimer la recette"
              >
                <Trash2 className="h-4 w-4 text-[var(--alert-text)]" aria-hidden />
              </Button>
            ) : null}
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
              Annuler
            </Button>
            <Button className="flex-1" onClick={submit} loading={pending}>
              Enregistrer
            </Button>
          </div>
        )
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Nom" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gratin de courgettes"
            maxLength={120}
            required
            data-autofocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Portions" hint="pour ces quantités" required>
            <Input
              type="number"
              min={1}
              max={50}
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              required
            />
          </Field>
          <div className="flex items-end pb-1">
            <button
              type="button"
              onClick={() => setIsFavorite((v) => !v)}
              aria-pressed={isFavorite}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 text-sm font-semibold transition-colors',
                isFavorite
                  ? 'border-transparent bg-honey-100 text-[var(--notice-fg)]'
                  : 'border-[var(--line)] text-[var(--fg-muted)]',
              )}
            >
              <Star
                className="h-4 w-4"
                fill={isFavorite ? 'currentColor' : 'none'}
                aria-hidden
              />
              Favori
            </button>
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Ingrédients</legend>
          <div className="space-y-2">
            {ingredients.map((item, index) => (
              <div
                key={item.key}
                className="rounded-2xl border border-[var(--line)] p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={item.label}
                    onChange={(e) => {
                      const label = e.target.value;
                      update(item.key, {
                        label,
                        aisle: item.aisle || (label.trim() ? guessAisle(label) : ''),
                      });
                    }}
                    placeholder={`Ingrédient ${index + 1}`}
                    aria-label={`Ingrédient ${index + 1}`}
                    maxLength={120}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    onClick={() =>
                      setIngredients((current) =>
                        current.length === 1
                          ? [emptyIngredient()]
                          : current.filter((i) => i.key !== item.key),
                      )
                    }
                    aria-label={`Retirer l'ingrédient ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted" aria-hidden />
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Input
                    value={item.quantity}
                    onChange={(e) => update(item.key, { quantity: e.target.value })}
                    inputMode="decimal"
                    placeholder="400"
                    aria-label={`Quantité de ${item.label || `l'ingrédient ${index + 1}`}`}
                  />
                  <Input
                    value={item.unit}
                    onChange={(e) => update(item.key, { unit: e.target.value })}
                    placeholder="g"
                    maxLength={30}
                    aria-label={`Unité de ${item.label || `l'ingrédient ${index + 1}`}`}
                  />
                  <Select
                    value={item.aisle}
                    onChange={(e) =>
                      update(item.key, { aisle: e.target.value as ShopAisle })
                    }
                    aria-label={`Rayon de ${item.label || `l'ingrédient ${index + 1}`}`}
                  >
                    <option value="">Rayon</option>
                    {AISLE_ORDER.map((aisle) => (
                      <option key={aisle} value={aisle}>
                        {AISLE_LABELS[aisle]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => setIngredients((current) => [...current, emptyIngredient()])}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Ajouter un ingrédient
          </Button>
        </fieldset>

        <Field label="Lien de la recette" hint="facultatif">
          <Input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        <Field label="Étapes" hint="facultatif">
          <Textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            rows={5}
            placeholder={'1. Préchauffer le four à 180 °C\n2. …'}
          />
        </Field>

        <Field label="Notes de cuisine" hint="facultatif">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000}
            rows={3} placeholder="Temps de cuisson, préparation à l’avance, réchauffage…" />
        </Field>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
