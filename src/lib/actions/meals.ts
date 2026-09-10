'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Database, ShopAisle } from '@/lib/database.types';
import {
  aggregateIngredients,
  guessAisle,
  normalizeLabel,
  parseUnit,
  type IngredientInput,
} from '@/lib/ingredients';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

const SLOTS = ['petit_dejeuner', 'dejeuner', 'diner'] as const;

const AISLES = [
  'fruits_legumes',
  'boucherie_poissonnerie',
  'frais',
  'epicerie',
  'surgeles',
  'boissons',
  'boulangerie',
  'maison',
  'hygiene',
  'bebe',
  'autre',
] as const;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/* -------------------------------------------------------------------------- */
/* Repas                                                                      */
/* -------------------------------------------------------------------------- */

const mealSchema = z.object({
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
  slot: z.enum(SLOTS),
  title: z.string().trim().min(1, 'Indiquez ce que vous mangez.').max(160),
  recipeId: z.string().uuid().nullable().optional(),
  servings: z.number().int().min(1).max(50).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
  childIds: z.array(z.string().uuid()).optional(),
});

export type MealInput = z.input<typeof mealSchema>;

/**
 * Enregistre un repas.
 *
 * Un repas peut n'être qu'un intitulé libre : la recette reste facultative,
 * car « restes » ou « pizza » n'ont pas besoin d'une fiche. La contrainte
 * d'unicité (date, créneau) fait qu'un même créneau est remplacé plutôt que
 * dupliqué.
 */
export async function saveMealAction(input: MealInput) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = mealSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const meal = parsed.data;
  const { supabase, household, member } = active.data;

  const { data, error } = await supabase
    .from('meals')
    .upsert(
      {
        household_id: household.id,
        meal_date: meal.mealDate,
        slot: meal.slot,
        title: meal.title,
        recipe_id: meal.recipeId ?? null,
        servings: meal.servings ?? null,
        notes: blankToNull(meal.notes),
        created_by: member.user_id,
      },
      { onConflict: 'household_id,meal_date,slot' },
    )
    .select('id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  if (meal.memberIds || meal.childIds) {
    await supabase.from('meal_participants').delete().eq('meal_id', data.id);

    const participants = [
      ...(meal.memberIds ?? []).map((id) => ({
        household_id: household.id,
        meal_id: data.id,
        member_id: id,
        child_id: null,
      })),
      ...(meal.childIds ?? []).map((id) => ({
        household_id: household.id,
        meal_id: data.id,
        member_id: null,
        child_id: id,
      })),
    ];

    if (participants.length > 0) {
      await supabase.from('meal_participants').insert(participants);
    }
  }

  revalidatePath('/');
  revalidatePath('/repas');
  return ok({ id: data.id });
}

export async function deleteMealAction(mealId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('meals')
    .delete()
    .eq('id', mealId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/repas');
  return ok();
}

/**
 * Déplace ou recopie un repas vers un autre jour ou créneau.
 *
 * Copier plutôt que déplacer sert à réutiliser un plat qui a plu ; déplacer
 * sert à décaler la semaine quand un imprévu survient.
 */
export async function moveMealAction(
  mealId: string,
  target: { mealDate: string; slot: (typeof SLOTS)[number] },
  mode: 'deplacer' | 'copier',
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = z
    .object({
      mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
      slot: z.enum(SLOTS),
    })
    .safeParse(target);

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { supabase, household, member } = active.data;

  const { data: source } = await supabase
    .from('meals')
    .select('*')
    .eq('id', mealId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!source) return fail("Ce repas n'existe plus.");

  const { error } = await supabase.from('meals').upsert(
    {
      household_id: household.id,
      meal_date: parsed.data.mealDate,
      slot: parsed.data.slot,
      title: source.title,
      recipe_id: source.recipe_id,
      servings: source.servings,
      notes: source.notes,
      created_by: member.user_id,
    },
    { onConflict: 'household_id,meal_date,slot' },
  );

  if (error) return fail(humanizeDbError(error));

  if (mode === 'deplacer') {
    await supabase.from('meals').delete().eq('id', mealId).eq('household_id', household.id);
  }

  revalidatePath('/repas');
  return ok();
}

/** Recopie une semaine entière vers une autre semaine. */
export async function copyWeekAction(fromMonday: string, toMonday: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = z
    .object({
      fromMonday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toMonday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse({ fromMonday, toMonday });

  if (!parsed.success) return fail('Dates invalides.');

  const { supabase, household, member } = active.data;

  const fromEnd = new Date(`${fromMonday}T00:00:00Z`);
  fromEnd.setUTCDate(fromEnd.getUTCDate() + 6);

  const { data: meals } = await supabase
    .from('meals')
    .select('*')
    .eq('household_id', household.id)
    .gte('meal_date', fromMonday)
    .lte('meal_date', fromEnd.toISOString().slice(0, 10));

  if (!meals || meals.length === 0) {
    return fail("Cette semaine-là ne contient aucun repas à recopier.");
  }

  const shiftDays = Math.round(
    (new Date(`${toMonday}T00:00:00Z`).getTime() -
      new Date(`${fromMonday}T00:00:00Z`).getTime()) /
      86_400_000,
  );

  const rows = meals.map((meal) => {
    const date = new Date(`${meal.meal_date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + shiftDays);
    return {
      household_id: household.id,
      meal_date: date.toISOString().slice(0, 10),
      slot: meal.slot,
      title: meal.title,
      recipe_id: meal.recipe_id,
      servings: meal.servings,
      notes: meal.notes,
      created_by: member.user_id,
    };
  });

  const { error } = await supabase
    .from('meals')
    .upsert(rows, { onConflict: 'household_id,meal_date,slot' });

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/repas');
  return ok({ count: rows.length });
}

/* -------------------------------------------------------------------------- */
/* Recettes                                                                   */
/* -------------------------------------------------------------------------- */

const recipeSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à la recette.').max(120),
  servings: z.number().int().min(1).max(50).default(4),
  steps: z.string().trim().max(10000).nullable().optional(),
  sourceUrl: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isFavorite: z.boolean().optional(),
  ingredients: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Chaque ingrédient doit avoir un nom.").max(120),
        quantity: z.number().positive().nullable().optional(),
        unit: z.string().trim().max(30).nullable().optional(),
        aisle: z.enum(AISLES).nullable().optional(),
      }),
    )
    .default([]),
});

export type RecipeInput = z.input<typeof recipeSchema>;

export async function saveRecipeAction(input: RecipeInput, recipeId?: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const recipe = parsed.data;
  const { supabase, household, member } = active.data;

  const payload = {
    household_id: household.id,
    name: recipe.name,
    servings: recipe.servings,
    steps: blankToNull(recipe.steps),
    source_url: blankToNull(recipe.sourceUrl),
    notes: blankToNull(recipe.notes),
    is_favorite: recipe.isFavorite ?? false,
    created_by: member.user_id,
  };

  const { data, error } = recipeId
    ? await supabase
        .from('recipes')
        .update(payload)
        .eq('id', recipeId)
        .eq('household_id', household.id)
        .select('id')
        .single()
    : await supabase.from('recipes').insert(payload).select('id').single();

  if (error || !data) return fail(humanizeDbError(error));

  // Les ingrédients sont réécrits en bloc : leur ordre compte et leur nombre
  // est petit.
  await supabase.from('recipe_ingredients').delete().eq('recipe_id', data.id);

  if (recipe.ingredients.length > 0) {
    const { error: ingredientsError } = await supabase.from('recipe_ingredients').insert(
      recipe.ingredients.map((ingredient, index) => ({
        household_id: household.id,
        recipe_id: data.id,
        label: ingredient.label,
        label_key: normalizeLabel(ingredient.label),
        quantity: ingredient.quantity ?? null,
        unit: parseUnit(ingredient.unit).canonical,
        aisle: (ingredient.aisle ?? guessAisle(ingredient.label)) as ShopAisle,
        position: index,
      })),
    );
    if (ingredientsError) return fail(humanizeDbError(ingredientsError));
  }

  revalidatePath('/repas');
  return ok({ id: data.id });
}

export async function deleteRecipeAction(recipeId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('recipes')
    .delete()
    .eq('id', recipeId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/repas');
  return ok();
}

export async function toggleRecipeFavoriteAction(recipeId: string, favorite: boolean) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('recipes')
    .update({ is_favorite: favorite })
    .eq('id', recipeId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/repas');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Génération des courses                                                     */
/* -------------------------------------------------------------------------- */

export type ShoppingPreviewLine = {
  labelKey: string;
  label: string;
  aisle: ShopAisle;
  quantity: number | null;
  unit: string | null;
  merged: boolean;
  /** Titres des repas ayant contribué, pour l'affichage. */
  sources: string[];
  /** Repas ayant contribué, pour pouvoir retirer cette ligne au prochain menu. */
  sourceMealIds: string[];
  /** Vrai si un article très proche est DÉJÀ dans la liste de courses. */
  alreadyInList: boolean;
};

/**
 * Prépare le récapitulatif à valider avant d'ajouter les courses.
 *
 * Rien n'est écrit ici : l'objectif est de montrer ce qui serait ajouté, avec
 * les ingrédients regroupés et les doublons signalés, pour que l'on puisse
 * décocher ce qu'on a déjà à la maison.
 */
export async function previewMealShoppingAction(mealIds: string[], listId?: string | null) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  if (mealIds.length === 0) return fail('Sélectionnez au moins un repas.');

  const { supabase, household } = active.data;

  const { data: meals } = await supabase
    .from('meals')
    .select('id, title, servings, recipe_id')
    .eq('household_id', household.id)
    .in('id', mealIds);

  if (!meals || meals.length === 0) return fail('Aucun repas sélectionné.');

  const recipeIds = meals
    .map((m) => m.recipe_id)
    .filter((id): id is string => Boolean(id));

  if (recipeIds.length === 0) {
    return fail(
      "Aucun des repas choisis n'est rattaché à une recette : il n'y a pas d'ingrédients à ajouter.",
    );
  }

  const [recipesResult, ingredientsResult, participantsResult] = await Promise.all([
    supabase.from('recipes').select('id, name, servings').in('id', recipeIds),
    supabase.from('recipe_ingredients').select('*').in('recipe_id', recipeIds).order('position'),
    supabase.from('meal_participants').select('meal_id').in('meal_id', mealIds),
  ]);

  const recipes = new Map((recipesResult.data ?? []).map((r) => [r.id, r]));
  const ingredients = ingredientsResult.data ?? [];

  const guestsByMeal = new Map<string, number>();
  for (const participant of participantsResult.data ?? []) {
    guestsByMeal.set(participant.meal_id, (guestsByMeal.get(participant.meal_id) ?? 0) + 1);
  }

  const inputs: IngredientInput[] = [];

  for (const meal of meals) {
    if (!meal.recipe_id) continue;
    const recipe = recipes.get(meal.recipe_id);
    if (!recipe) continue;

    // Nombre de portions visé : celui du repas, sinon le nombre de convives,
    // sinon celui de la recette.
    const target = meal.servings ?? guestsByMeal.get(meal.id) ?? recipe.servings;
    const scale = recipe.servings > 0 ? target / recipe.servings : 1;

    for (const ingredient of ingredients.filter((i) => i.recipe_id === meal.recipe_id)) {
      inputs.push({
        label: ingredient.label,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        aisle: ingredient.aisle,
        mealId: meal.id,
        mealTitle: meal.title,
        scale,
      });
    }
  }

  const aggregated = aggregateIngredients(inputs);

  // Ce qui est déjà sur la liste, pour le signaler plutôt que de l'ajouter
  // en double sans prévenir.
  let existingKeys = new Set<string>();
  if (listId) {
    const { data: existing } = await supabase
      .from('shopping_items')
      .select('label_key')
      .eq('list_id', listId)
      .eq('is_checked', false);
    existingKeys = new Set((existing ?? []).map((i) => i.label_key));
  }

  const lines: ShoppingPreviewLine[] = [];

  for (const item of aggregated) {
    for (const line of item.lines) {
      lines.push({
        labelKey: item.labelKey,
        label: item.label,
        aisle: item.aisle,
        quantity: line.quantity,
        unit: line.unit,
        merged: line.merged,
        sources: item.sources
          .map((s) => s.mealTitle)
          .filter((t): t is string => Boolean(t)),
        sourceMealIds: item.sources
          .map((s) => s.mealId)
          .filter((id): id is string => Boolean(id)),
        alreadyInList: existingKeys.has(item.labelKey),
      });
    }
  }

  return ok({ lines });
}

const confirmSchema = z.object({
  listId: z.string().uuid().nullable().optional(),
  mealIds: z.array(z.string().uuid()).default([]),
  lines: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        quantity: z.number().positive().nullable(),
        unit: z.string().trim().max(30).nullable(),
        aisle: z.enum(AISLES),
        sourceMealIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .min(1, 'Aucun ingrédient retenu.'),
});

/**
 * Ajoute à la liste les ingrédients retenus dans le récapitulatif.
 *
 * Les lignes déjà issues des MÊMES repas sont d'abord retirées, afin qu'un
 * changement de menu ne laisse pas les ingrédients de l'ancien. Les articles
 * ajoutés à la main (`source = 'manuel'`) ne sont jamais touchés : c'est
 * exactement ce que le cahier des charges demande de préserver.
 */
export async function confirmMealShoppingAction(input: z.input<typeof confirmSchema>) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { listId, mealIds, lines } = parsed.data;
  const { supabase, household, member } = active.data;

  let targetList = listId ?? null;
  if (!targetList) {
    const { data } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('household_id', household.id)
      .order('is_default', { ascending: false })
      .order('created_at')
      .limit(1);
    targetList = data?.[0]?.id ?? null;
  }
  if (!targetList) return fail('Aucune liste de courses disponible.');

  if (mealIds.length > 0) {
    await supabase
      .from('shopping_items')
      .delete()
      .eq('list_id', targetList)
      .eq('source', 'repas')
      .eq('is_checked', false)
      .in('source_meal_id', mealIds);
  }

  const rows: Database['public']['Tables']['shopping_items']['Insert'][] = lines.map(
    (line) => ({
      household_id: household.id,
      list_id: targetList!,
      label: line.label,
      label_key: normalizeLabel(line.label),
      quantity: line.quantity,
      unit: line.unit,
      aisle: line.aisle as ShopAisle,
      source: 'repas' as const,
      // Repas de rattachement : le premier qui a contribué à CETTE ligne, et
      // non le premier de la sélection. C'est lui qui permettra de retirer la
      // ligne quand ce repas changera.
      source_meal_id: line.sourceMealIds[0] ?? mealIds[0] ?? null,
      created_by: member.user_id,
    }),
  );

  const { error } = await supabase.from('shopping_items').insert(rows);
  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/listes');
  revalidatePath('/repas');
  return ok({ count: rows.length });
}
