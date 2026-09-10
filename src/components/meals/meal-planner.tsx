'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Plus,
  ShoppingBasket,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { useHouseholdRealtime } from '@/components/providers/use-realtime';
import { MealSheet, SLOT_LABELS } from '@/components/meals/meal-sheet';
import { RecipeSheet } from '@/components/meals/recipe-sheet';
import { ShoppingPreviewSheet } from '@/components/meals/shopping-preview-sheet';
import { copyWeekAction } from '@/lib/actions/meals';
import { addDays, formatDayLong, startOfWeek, todayIn } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type { MealRow, MealSlot, RecipeRow } from '@/lib/database.types';

const SLOTS: MealSlot[] = ['petit_dejeuner', 'dejeuner', 'diner'];

export function MealPlanner({
  monday,
  meals,
  recipes,
  participants,
  defaultListId,
}: {
  monday: string;
  meals: MealRow[];
  recipes: RecipeRow[];
  participants: { meal_id: string; member_id: string | null; child_id: string | null }[];
  defaultListId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { household } = useHousehold();

  // Le planning des repas se remplit souvent à deux, chacun de son côté.
  useHouseholdRealtime(household.id, ['meals']);
  const today = todayIn(household.timezone);

  const [editing, setEditing] = React.useState<{ day: string; slot: MealSlot } | null>(null);
  const [recipesOpen, setRecipesOpen] = React.useState(false);
  const [editingRecipe, setEditingRecipe] = React.useState<RecipeRow | null>(null);
  const [creatingRecipe, setCreatingRecipe] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [selectedMeals, setSelectedMeals] = React.useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [copyingWeek, setCopyingWeek] = React.useState(false);
  /* Le petit-déjeuner est facultatif : il n'apparaît que si on le demande ou
     s'il contient déjà quelque chose. */
  const [showBreakfast, setShowBreakfast] = React.useState(
    meals.some((m) => m.slot === 'petit_dejeuner'),
  );

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const visibleSlots = showBreakfast ? SLOTS : SLOTS.filter((s) => s !== 'petit_dejeuner');

  function mealAt(day: string, slot: MealSlot) {
    return meals.find((m) => m.meal_date === day && m.slot === slot) ?? null;
  }

  function goToWeek(nextMonday: string) {
    router.push(`/repas?semaine=${nextMonday}`);
  }

  function toggleMealSelection(mealId: string) {
    setSelectedMeals((current) =>
      current.includes(mealId)
        ? current.filter((id) => id !== mealId)
        : [...current, mealId],
    );
  }

  async function copyPreviousWeek() {
    setCopyingWeek(true);
    const result = await copyWeekAction(addDays(monday, -7), monday);
    setCopyingWeek(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.data.count} repas recopiés depuis la semaine précédente.`);
    router.refresh();
  }

  const mealsWithRecipe = meals.filter((m) => m.recipe_id);
  const editingMeal = editing ? mealAt(editing.day, editing.slot) : null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="truncate text-xl font-extrabold tracking-tight">
          Semaine du {formatDayLong(monday, { withYear: false })}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => goToWeek(addDays(monday, -7))}
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToWeek(startOfWeek(today))}
          >
            Cette semaine
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => goToWeek(addDays(monday, 7))}
            aria-label="Semaine suivante"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setRecipesOpen(true)}>
          <BookOpen className="h-4 w-4" aria-hidden />
          Recettes ({recipes.length})
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={copyPreviousWeek}
          loading={copyingWeek}
        >
          <CopyPlus className="h-4 w-4" aria-hidden />
          Reprendre la semaine passée
        </Button>
        <Button
          variant={selecting ? 'primary' : 'outline'}
          size="sm"
          onClick={() => {
            if (selecting) {
              setSelecting(false);
              setSelectedMeals([]);
            } else {
              setSelecting(true);
              setSelectedMeals(mealsWithRecipe.map((m) => m.id));
            }
          }}
          disabled={mealsWithRecipe.length === 0}
        >
          <ShoppingBasket className="h-4 w-4" aria-hidden />
          {selecting ? 'Annuler la sélection' : 'Générer les courses'}
        </Button>
        {!showBreakfast ? (
          <Button variant="ghost" size="sm" onClick={() => setShowBreakfast(true)}>
            + Petit-déjeuner
          </Button>
        ) : null}
      </div>

      {selecting ? (
        <div className="surface sticky top-2 z-10 mb-4 flex items-center gap-3 rounded-[var(--radius-xl2)] p-3">
          <p className="min-w-0 flex-1 text-sm">
            <strong>{selectedMeals.length}</strong> repas sélectionné
            {selectedMeals.length > 1 ? 's' : ''}
            <span className="block text-xs text-muted">
              Seuls les repas rattachés à une recette ont des ingrédients.
            </span>
          </p>
          <Button
            size="sm"
            onClick={() => setPreviewOpen(true)}
            disabled={selectedMeals.length === 0}
          >
            Continuer
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {days.map((day) => (
          <section
            key={day}
            className={cn(
              'surface rounded-[var(--radius-xl2)] p-3',
              day === today && 'ring-2 ring-brand-200',
            )}
          >
            <h2
              className={cn(
                'mb-2 text-sm font-bold first-letter:uppercase',
                day === today ? 'text-brand-600' : 'text-muted',
              )}
            >
              {formatDayLong(day, { withYear: false })}
            </h2>

            <div className="grid gap-2 sm:grid-cols-2">
              {visibleSlots.map((slot) => {
                const meal = mealAt(day, slot);
                const selected = meal ? selectedMeals.includes(meal.id) : false;
                const hasRecipe = Boolean(meal?.recipe_id);

                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => {
                      if (selecting) {
                        if (meal && hasRecipe) toggleMealSelection(meal.id);
                        return;
                      }
                      setEditing({ day, slot });
                    }}
                    disabled={selecting && !hasRecipe}
                    className={cn(
                      'rounded-2xl border-2 p-2.5 text-left transition-colors',
                      selecting && hasRecipe && selected
                        ? 'border-brand-500 bg-brand-50 dark:bg-white/5'
                        : selecting && hasRecipe
                          ? 'border-[var(--line)]'
                          : selecting
                            ? 'border-transparent bg-[var(--bg-subtle)] opacity-40'
                            : meal
                              ? 'border-transparent bg-[var(--bg-subtle)] hover:bg-sand-300/60 dark:hover:bg-white/10'
                              : 'border-dashed border-[var(--line)] hover:bg-[var(--bg-subtle)]',
                    )}
                  >
                    <span className="block text-[0.7rem] font-bold uppercase tracking-wide text-muted">
                      {SLOT_LABELS[slot]}
                    </span>
                    {meal ? (
                      <>
                        <span className="mt-0.5 block truncate text-sm font-semibold">
                          {meal.title}
                        </span>
                        {hasRecipe ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                            <BookOpen className="h-3 w-3" aria-hidden />
                            recette
                            {meal.servings ? ` · ${meal.servings} pers.` : ''}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Ajouter
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* --- Feuilles ----------------------------------------------------- */}
      {editing ? (
        <MealSheet
          open
          onClose={() => setEditing(null)}
          day={editing.day}
          slot={editing.slot}
          meal={editingMeal}
          recipes={recipes}
          weekDays={days}
          participantMemberIds={
            editingMeal
              ? participants
                  .filter((p) => p.meal_id === editingMeal.id && p.member_id)
                  .map((p) => p.member_id!)
              : []
          }
          participantChildIds={
            editingMeal
              ? participants
                  .filter((p) => p.meal_id === editingMeal.id && p.child_id)
                  .map((p) => p.child_id!)
              : []
          }
        />
      ) : null}

      <Sheet
        open={recipesOpen}
        onClose={() => setRecipesOpen(false)}
        title="Recettes"
        footer={
          <div className="pb-1">
            <Button
              className="w-full"
              onClick={() => {
                setRecipesOpen(false);
                setCreatingRecipe(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nouvelle recette
            </Button>
          </div>
        }
      >
        {recipes.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-7 w-7" aria-hidden />}
            title="Aucune recette"
            description="Une recette avec ses ingrédients permet de générer les courses en un geste."
          />
        ) : (
          <ul className="space-y-1.5">
            {[...recipes]
              .sort((a, b) =>
                a.is_favorite === b.is_favorite
                  ? a.name.localeCompare(b.name, 'fr')
                  : a.is_favorite
                    ? -1
                    : 1,
              )
              .map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setRecipesOpen(false);
                      setEditingRecipe(recipe);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-2xl border border-[var(--line)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    {recipe.is_favorite ? (
                      <Star
                        className="h-4 w-4 shrink-0 text-honey-500"
                        fill="currentColor"
                        aria-label="Favori"
                      />
                    ) : (
                      <BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {recipe.name}
                      </span>
                      <span className="block text-xs text-muted">
                        Pour {recipe.servings} personne{recipe.servings > 1 ? 's' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Sheet>

      <RecipeSheet open={creatingRecipe} onClose={() => setCreatingRecipe(false)} />
      <RecipeSheet
        open={Boolean(editingRecipe)}
        onClose={() => setEditingRecipe(null)}
        recipe={editingRecipe}
      />

      <ShoppingPreviewSheet
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setSelecting(false);
          setSelectedMeals([]);
        }}
        mealIds={selectedMeals}
        listId={defaultListId}
      />
    </div>
  );
}
