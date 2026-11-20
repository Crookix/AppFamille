import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { RecipeDetail } from '@/components/meals/recipe-detail';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Fiche recette' };

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { household } = await requireHousehold();
  const supabase = await createClient();
  const [recipe, ingredients] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', id).eq('household_id', household.id).maybeSingle(),
    supabase.from('recipe_ingredients').select('*').eq('recipe_id', id)
      .eq('household_id', household.id).order('position'),
  ]);
  if (recipe.error || ingredients.error) throw new Error('Impossible de charger la fiche recette.');
  if (!recipe.data) notFound();
  return <RecipeDetail recipe={recipe.data} ingredients={ingredients.data} />;
}
