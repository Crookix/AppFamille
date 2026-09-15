'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ShopAisle } from '@/lib/database.types';
import { combineQuantities, guessAisle, normalizeLabel, parseUnit } from '@/lib/ingredients';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

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

const itemSchema = z.object({
  listId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1, "Indiquez le nom de l'article.").max(120),
  quantity: z.number().positive('La quantité doit être positive.').nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  aisle: z.enum(AISLES).nullable().optional(),
});

export type ShoppingItemInput = z.input<typeof itemSchema>;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Liste par défaut du foyer, créée à la volée si elle a été supprimée. */
async function resolveListId(
  client: SupabaseClient<Database>,
  householdId: string,
  requested: string | null | undefined,
): Promise<string | null> {
  if (requested) return requested;

  const { data: defaultList } = await client
    .from('shopping_lists')
    .select('id')
    .eq('household_id', householdId)
    .eq('is_default', true)
    .maybeSingle();

  if (defaultList) return defaultList.id;

  const { data: anyList } = await client
    .from('shopping_lists')
    .select('id')
    .eq('household_id', householdId)
    .order('created_at')
    .limit(1);

  if (anyList && anyList.length > 0) return anyList[0].id;

  const { data: created } = await client
    .from('shopping_lists')
    .insert({ household_id: householdId, name: 'Courses', is_default: true })
    .select('id')
    .single();

  return created?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Articles                                                                   */
/* -------------------------------------------------------------------------- */

export async function addShoppingItemAction(input: ShoppingItemInput) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const item = parsed.data;
  const { supabase, household, member } = active.data;

  const listId = await resolveListId(supabase, household.id, item.listId);
  if (!listId) return fail("Aucune liste de courses disponible.");

  const labelKey = normalizeLabel(item.label);
  const unit = parseUnit(item.unit).canonical;
  const aisle: ShopAisle = item.aisle ?? guessAisle(item.label);

  /* --- Fusion plutôt que doublon (critère 3.4) ---------------------------
     Deux lignes « pommes » dans la même liste, c'est une liste qu'on relit
     mal et un article qu'on achète deux fois.

     On ne fusionne QUE dans une ligne saisie à la main. Une ligne venue des
     repas porte son `source_meal_id` : la régénération du menu supprime les
     lignes « repas » non cochées de ces repas, et emporterait avec elle ce
     que quelqu'un y aurait ajouté à la main. Mieux vaut deux lignes qu'une
     ligne qui disparaît toute seule.

     Une ligne déjà cochée est laissée tranquille : elle est achetée. */
  const { data: existante } = await supabase
    .from('shopping_items')
    .select('*')
    .eq('household_id', household.id)
    .eq('list_id', listId)
    .eq('label_key', labelKey)
    .eq('source', 'manuel')
    .eq('is_checked', false)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (existante) {
    /* `numeric` revient de PostgREST en CHAÎNE, pour ne pas perdre de précision
       en passant par un nombre flottant — le dépôt le sait déjà ailleurs
       (`Number(rate.hourly_rate)`). Le type déclaré dit `number` ; on ne s'en
       remet donc pas à lui, ni à la coercition implicite de `*`. */
    const quantiteExistante =
      existante.quantity == null ? null : Number(existante.quantity);

    const fusion = Number.isFinite(quantiteExistante ?? 0)
      ? combineQuantities(
          { quantity: quantiteExistante, unit: existante.unit },
          { quantity: item.quantity ?? null, unit },
        )
      : null;

    if (fusion) {
      const { data: fusionnee, error: fusionError } = await supabase
        .from('shopping_items')
        .update({
          quantity: fusion.quantity,
          unit: fusion.unit,
          // Le libellé et le rayon déjà en place font foi : quelqu'un a pu les
          // corriger à la main, et un ajout ne doit pas défaire cette correction.
          note: existante.note ?? blankToNull(item.note),
        })
        .eq('id', existante.id)
        .select('*')
        .single();

      if (fusionError || !fusionnee) return fail(humanizeDbError(fusionError));

      await rememberFrequentItem(supabase, household.id, item.label.trim(), labelKey, unit, aisle);

      revalidatePath('/');
      revalidatePath('/listes');
      return ok({ item: fusionnee, merged: true });
    }
    // Unités inconciliables (« 1 kg » et « 1 L ») : deux lignes valent mieux
    // qu'une addition fausse.
  }

  const { data, error } = await supabase
    .from('shopping_items')
    .insert({
      household_id: household.id,
      list_id: listId,
      label: item.label.trim(),
      label_key: labelKey,
      quantity: item.quantity ?? null,
      unit,
      note: blankToNull(item.note),
      aisle,
      source: 'manuel',
      created_by: member.user_id,
    })
    .select('*')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  await rememberFrequentItem(supabase, household.id, item.label.trim(), labelKey, unit, aisle);

  revalidatePath('/');
  revalidatePath('/listes');
  return ok({ item: data, merged: false });
}

/**
 * Coche ou décoche un article.
 *
 * Le foyer voit le changement en direct grâce à la diffusion temps réel : deux
 * adultes dans le même magasin ne rachètent pas la même chose.
 */
export async function toggleShoppingItemAction(itemId: string, checked: boolean) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('shopping_items')
    .update({
      is_checked: checked,
      checked_by: checked ? active.data.member.id : null,
    })
    .eq('id', itemId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/listes');
  return ok();
}

export async function updateShoppingItemAction(
  itemId: string,
  input: Partial<ShoppingItemInput>,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = itemSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const item = parsed.data;
  const patch: Database['public']['Tables']['shopping_items']['Update'] = {};

  if (item.label !== undefined) {
    patch.label = item.label.trim();
    patch.label_key = normalizeLabel(item.label);
  }
  if (item.quantity !== undefined) patch.quantity = item.quantity;
  if (item.unit !== undefined) patch.unit = parseUnit(item.unit).canonical;
  if (item.note !== undefined) patch.note = blankToNull(item.note);
  if (item.aisle !== undefined && item.aisle !== null) patch.aisle = item.aisle;

  if (Object.keys(patch).length === 0) return ok();

  const { error } = await active.data.supabase
    .from('shopping_items')
    .update(patch)
    .eq('id', itemId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

export async function deleteShoppingItemAction(itemId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('shopping_items')
    .delete()
    .eq('id', itemId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/listes');
  return ok();
}

/** Retire d'un coup tous les articles déjà achetés d'une liste. */
export async function clearCheckedItemsAction(listId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('shopping_items')
    .delete()
    .eq('list_id', listId)
    .eq('household_id', active.data.household.id)
    .eq('is_checked', true);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Listes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createShoppingListAction(name: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = z
    .string()
    .trim()
    .min(1, 'Donnez un nom à la liste.')
    .max(60)
    .safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { data, error } = await active.data.supabase
    .from('shopping_lists')
    .insert({
      household_id: active.data.household.id,
      name: parsed.data,
      is_default: false,
      created_by: active.data.member.user_id,
    })
    .select('id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok({ id: data.id });
}

export async function deleteShoppingListAction(listId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { data: list } = await active.data.supabase
    .from('shopping_lists')
    .select('is_default')
    .eq('id', listId)
    .eq('household_id', active.data.household.id)
    .maybeSingle();

  if (!list) return fail('Cette liste n’existe plus.');
  if (list.is_default) {
    return fail('La liste principale ne peut pas être supprimée.');
  }

  const { error } = await active.data.supabase
    .from('shopping_lists')
    .delete()
    .eq('id', listId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Articles fréquents                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Mémorise un article pour le proposer à l'ajout rapide.
 *
 * Un échec est sans conséquence : c'est une commodité, pas une donnée du
 * foyer. On ne fait donc pas remonter l'erreur.
 */
async function rememberFrequentItem(
  client: SupabaseClient<Database>,
  householdId: string,
  label: string,
  labelKey: string,
  unit: string | null,
  aisle: ShopAisle,
) {
  try {
    const { data: existing } = await client
      .from('frequent_items')
      .select('id, use_count')
      .eq('household_id', householdId)
      .eq('label_key', labelKey)
      .maybeSingle();

    if (existing) {
      await client
        .from('frequent_items')
        .update({
          use_count: existing.use_count + 1,
          last_used_at: new Date().toISOString(),
          unit,
          aisle,
        })
        .eq('id', existing.id);
      return;
    }

    await client.from('frequent_items').insert({
      household_id: householdId,
      label,
      label_key: labelKey,
      unit,
      aisle,
    });
  } catch {
    /* sans effet sur l'ajout de l'article */
  }
}
