import type { Metadata } from 'next';
import { RecipeBook } from '@/components/meals/recipe-book';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Recette' };

export default async function RecipesPage() {
  const { household } = await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase.from('recipes')
    .select('id, name, servings, is_favorite')
    .eq('household_id', household.id)
    .order('is_favorite', { ascending: false }).order('name');

  if (error) throw new Error('Impossible de charger le carnet de recettes.');
  return <RecipeBook recipes={data} />;
}
