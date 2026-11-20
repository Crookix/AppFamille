'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Plus,
  ShoppingBasket,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { useHouseholdRealtime } from '@/components/providers/use-realtime';
import { MealSheet, SLOT_LABELS } from '@/components/meals/meal-sheet';
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
  planningRecipe,
}: {
  monday: string;
  meals: MealRow[];
  recipes: RecipeRow[];
  participants: { meal_id: string; member_id: string | null; child_id: string | null }[];
  defaultListId: string | null;
  planningRecipe: RecipeRow | null;
}) {
  const router = useRouter();
  const [changingWeek, startWeekTransition] = React.useTransition();
  const toast = useToast();
  const { household } = useHousehold();

  // Le planning des repas se remplit souvent à deux, chacun de son côté.
  useHouseholdRealtime(household.id, ['meals']);
  const today = todayIn(household.timezone);

  const [editing, setEditing] = React.useState<{ day: string; slot: MealSlot } | null>(null);
  const [selecting, setSelecting] = React.useState(false);
  const [selectedMeals, setSelectedMeals] = React.useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [copyingWeek, setCopyingWeek] = React.useState(false);
  /* La semaine montre les dîners. Le petit-déjeuner et le déjeuner sont
     facultatifs : chacun n'apparaît que si on le demande ou s'il contient
     déjà quelque chose — un repas déjà saisi ne disparaît jamais de l'écran. */
  const [showBreakfast, setShowBreakfast] = React.useState(
    meals.some((m) => m.slot === 'petit_dejeuner'),
  );
  const [showLunch, setShowLunch] = React.useState(meals.some((m) => m.slot === 'dejeuner'));

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const visibleSlots = SLOTS.filter(
    (slot) =>
      (slot !== 'petit_dejeuner' || showBreakfast) && (slot !== 'dejeuner' || showLunch),
  );

  function mealAt(day: string, slot: MealSlot) {
    return meals.find((m) => m.meal_date === day && m.slot === slot) ?? null;
  }

  function goToWeek(nextMonday: string) {
    const params = new URLSearchParams({ semaine: nextMonday });
    if (planningRecipe) params.set('recette', planningRecipe.id);
    startWeekTransition(() => router.push(`/repas?${params}`));
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
      <div className="mb-3 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <h1 className="text-balance text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">
          Semaine du {formatDayLong(monday, { withYear: false })}
        </h1>
        <div className="-ml-2 flex shrink-0 items-center gap-1">
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

      {planningRecipe ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-brand-50 p-3">
          <p className="min-w-0 flex-1 text-sm">Choisissez un repas pour <strong>{planningRecipe.name}</strong>.</p>
          <Link href={`/repas?semaine=${monday}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Annuler
          </Link>
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {!planningRecipe && (
          <>
            <Link href="/recettes" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <BookOpen className="h-4 w-4" aria-hidden />
              Recettes ({recipes.length})
            </Link>
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
          </>
        )}
        {!showBreakfast || !showLunch ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowBreakfast(true);
              setShowLunch(true);
            }}
          >
            + Autres repas
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

      <div className="space-y-3" aria-busy={changingWeek}>
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
                day === today ? 'text-[var(--accent-text)]' : 'text-muted',
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
                  <div
                    key={slot}
                    className={cn(
                      'min-w-0 rounded-2xl border-2 text-left transition-colors',
                      selecting && hasRecipe && selected
                        ? 'border-brand-500 bg-brand-50'
                        : selecting && hasRecipe
                          ? 'border-[var(--line)]'
                          : selecting
                            ? 'border-transparent bg-[var(--bg-subtle)] opacity-40'
                            : meal
                              ? 'border-transparent bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)]'
                              : 'border-dashed border-[var(--line)] hover:bg-[var(--bg-subtle)]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (selecting) {
                          if (meal && hasRecipe) toggleMealSelection(meal.id);
                          return;
                        }
                        setEditing({ day, slot });
                      }}
                      disabled={changingWeek || (selecting && !hasRecipe)}
                      className="block min-h-11 w-full rounded-2xl p-2.5 text-left"
                    >
                      <span className="block text-[0.75rem] font-bold uppercase tracking-wide text-muted">
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
                    {meal?.recipe_id && !selecting && !planningRecipe && (
                      <Link href={`/recettes/${meal.recipe_id}`}
                        className="flex min-h-11 items-center gap-1.5 px-2.5 text-sm font-semibold text-[var(--accent-text)]">
                        <BookOpen className="h-4 w-4" aria-hidden /> Voir la recette
                      </Link>
                    )}
                  </div>
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
          suggestedRecipe={planningRecipe}
          onSaved={planningRecipe ? () => router.replace(`/repas?semaine=${monday}`) : undefined}
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
