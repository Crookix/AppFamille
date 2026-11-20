'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { normalizeLabel, parseUnit } from '@/lib/ingredients';
import { menuNotes, menuServings, novemberRecipes } from '@/lib/november-recipes';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

// UUID v5 : deux parents qui ajoutent la sélection obtiennent les mêmes fiches
// dans leur foyer, et des identifiants distincts de ceux des autres foyers.
function namedUuid(namespace: string, name: string) {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex')).update(name).digest();
  hash[6] = (hash[6] & 15) | 80;
  hash[8] = (hash[8] & 63) | 128;
  const hex = hash.subarray(0, 16).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export async function addNovemberRecipesAction(expectedHouseholdId: string) {
  if (!z.uuid().safeParse(expectedHouseholdId).success) return fail('Foyer introuvable.');
  const active = await requireActiveHousehold();
  if (!active.ok) return active;
  const { household, member, supabase } = active.data;
  if (household.id !== expectedHouseholdId) return fail('Le foyer actif a changé. Rechargez la sélection.');

  const selection = novemberRecipes.map((recipe) => ({
    recipe, id: namedUuid(household.id, `myfamily/novembre/${recipe.key}`),
  }));
  const ids = selection.map(({ id }) => id);
  const [existing, ingredients] = await Promise.all([
    supabase.from('recipes').select('id, created_at, updated_at').eq('household_id', household.id).in('id', ids),
    supabase.from('recipe_ingredients').select('recipe_id').eq('household_id', household.id).in('recipe_id', ids),
  ]);
  if (existing.error || ingredients.error) return fail(humanizeDbError(existing.error ?? ingredients.error));

  // Les ingrédients sont insérés ensemble. Une fiche neuve sans ingrédients
  // indique un ajout interrompu. Une fiche modifiée par le foyer est conservée.
  const complete = new Set(ingredients.data.map((i) => i.recipe_id));
  for (const row of existing.data) if (row.updated_at !== row.created_at) complete.add(row.id);
  const pending = selection.filter(({ id }) => !complete.has(id));
  if (pending.length) {
    const recipes = await supabase.from('recipes').upsert(pending.map(({ recipe, id }) => ({
      id, household_id: household.id, created_by: member.user_id, name: recipe.name,
      servings: menuServings, steps: recipe.steps.join('\n'), notes: menuNotes(recipe),
    })), { onConflict: 'id', ignoreDuplicates: true });
    if (recipes.error) return fail(humanizeDbError(recipes.error));

    const rows = pending.flatMap(({ id, recipe }) => recipe.ingredients.map(([label, quantity, unit, aisle], position) => ({
      id: namedUuid(id, String(position)), household_id: household.id, recipe_id: id,
      label, label_key: normalizeLabel(label), quantity, unit: parseUnit(unit).canonical, aisle, position,
    })));
    const added = await supabase.from('recipe_ingredients').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (added.error) return fail(humanizeDbError(added.error));
  }
  revalidatePath('/recettes');
  revalidatePath('/repas');
  return ok();
}
