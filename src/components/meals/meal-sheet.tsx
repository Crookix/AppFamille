'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Copy, MoveRight, Trash2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { PeoplePicker } from '@/components/events/pickers';
import { deleteMealAction, moveMealAction, saveMealAction } from '@/lib/actions/meals';
import { formatDayLong } from '@/lib/datetime';
import type { MealRow, MealSlot, RecipeRow } from '@/lib/database.types';

export const SLOT_LABELS: Record<MealSlot, string> = {
  petit_dejeuner: 'Petit-déjeuner',
  dejeuner: 'Déjeuner',
  diner: 'Dîner',
};

/**
 * Saisie d'un repas.
 *
 * Le champ principal est un simple intitulé : on peut écrire « restes » et
 * refermer. Choisir une recette est un raccourci, jamais une obligation.
 */
export function MealSheet({
  open,
  onClose,
  day,
  slot,
  meal,
  recipes,
  participantMemberIds = [],
  participantChildIds = [],
  weekDays,
}: {
  open: boolean;
  onClose: () => void;
  day: string;
  slot: MealSlot;
  meal: MealRow | null;
  recipes: RecipeRow[];
  participantMemberIds?: string[];
  participantChildIds?: string[];
  weekDays: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { members, children } = useHousehold();

  const [title, setTitle] = React.useState('');
  const [recipeId, setRecipeId] = React.useState<string | null>(null);
  const [servings, setServings] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [people, setPeople] = React.useState<{ memberIds: string[]; childIds: string[] }>({
    memberIds: [],
    childIds: [],
  });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState({ day, slot });

  React.useEffect(() => {
    if (!open) return;

    setTitle(meal?.title ?? '');
    setRecipeId(meal?.recipe_id ?? null);
    setServings(meal?.servings ? String(meal.servings) : '');
    setNotes(meal?.notes ?? '');
    setError(null);
    setMoving(false);
    setMoveTarget({ day, slot });

    // Par défaut, tout le foyer est présent : c'est le cas le plus courant.
    setPeople({
      memberIds:
        participantMemberIds.length > 0 ? participantMemberIds : members.map((m) => m.id),
      childIds:
        participantChildIds.length > 0 ? participantChildIds : children.map((c) => c.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meal?.id, day, slot]);

  function chooseRecipe(id: string | null) {
    setRecipeId(id);
    const recipe = recipes.find((r) => r.id === id);
    // Le titre suit la recette tant qu'on ne l'a pas écrit soi-même.
    if (recipe && (!title.trim() || recipes.some((r) => r.name === title))) {
      setTitle(recipe.name);
    }
    if (recipe && !servings) setServings(String(recipe.servings));
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Indiquez ce que vous mangez.');
      return;
    }

    setPending(true);

    const result = await saveMealAction({
      mealDate: day,
      slot,
      title: title.trim(),
      recipeId,
      servings: servings ? Number(servings) : null,
      notes,
      memberIds: people.memberIds,
      childIds: people.childIds,
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success('Repas enregistré.');
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!meal) return;
    setPending(true);
    const result = await deleteMealAction(meal.id);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Repas retiré.');
    onClose();
    router.refresh();
  }

  async function relocate(mode: 'deplacer' | 'copier') {
    if (!meal) return;
    setPending(true);
    const result = await moveMealAction(
      meal.id,
      { mealDate: moveTarget.day, slot: moveTarget.slot },
      mode,
    );
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(mode === 'copier' ? 'Repas recopié.' : 'Repas déplacé.');
    onClose();
    router.refresh();
  }

  const guestCount = people.memberIds.length + people.childIds.length;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${SLOT_LABELS[slot]} — ${formatDayLong(day, { withYear: false })}`}
      footer={
        <div className="flex gap-2 pb-1">
          {meal ? (
            <Button variant="outline" size="icon" onClick={remove} aria-label="Retirer ce repas">
              <Trash2 className="h-4 w-4 text-alert-500" aria-hidden />
            </Button>
          ) : null}
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} loading={pending}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Au menu" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Gratin de courgettes"
            maxLength={160}
            required
            data-autofocus
          />
        </Field>

        {recipes.length > 0 ? (
          <Field
            label="Recette"
            hint="facultatif — sert à générer les courses"
          >
            <Select value={recipeId ?? ''} onChange={(e) => chooseRecipe(e.target.value || null)}>
              <option value="">Aucune recette</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.is_favorite ? '★ ' : ''}
                  {recipe.name} ({recipe.servings} pers.)
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="flex items-start gap-2 rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-muted">
            <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Enregistrez des recettes avec leurs ingrédients pour pouvoir générer les
              courses automatiquement.
            </span>
          </p>
        )}

        <PeoplePicker
          label="Qui est là"
          memberIds={people.memberIds}
          childIds={people.childIds}
          onChange={setPeople}
        />

        <Field
          label="Nombre de portions"
          hint={guestCount > 0 ? `${guestCount} convive(s) sélectionné(s)` : 'facultatif'}
        >
          <Input
            type="number"
            min={1}
            max={50}
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            placeholder={String(guestCount || 4)}
          />
        </Field>

        <Field label="Notes" hint="facultatif">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Sortir la viande la veille"
          />
        </Field>

        {meal ? (
          <div className="rounded-2xl border border-[var(--line)] p-3.5">
            {!moving ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setMoving(true)}
              >
                <MoveRight className="h-4 w-4" aria-hidden />
                Déplacer ou recopier ce repas
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Vers le jour">
                    <Select
                      value={moveTarget.day}
                      onChange={(e) =>
                        setMoveTarget((t) => ({ ...t, day: e.target.value }))
                      }
                    >
                      {weekDays.map((d) => (
                        <option key={d} value={d}>
                          {formatDayLong(d, { withYear: false })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Créneau">
                    <Select
                      value={moveTarget.slot}
                      onChange={(e) =>
                        setMoveTarget((t) => ({ ...t, slot: e.target.value as MealSlot }))
                      }
                    >
                      {(Object.keys(SLOT_LABELS) as MealSlot[]).map((s) => (
                        <option key={s} value={s}>
                          {SLOT_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => relocate('copier')}
                    disabled={pending}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Recopier
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => relocate('deplacer')}
                    disabled={pending}
                  >
                    <MoveRight className="h-4 w-4" aria-hidden />
                    Déplacer
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
