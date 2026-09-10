import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { MealPlanner } from '@/components/meals/meal-planner';
import { addDays, startOfWeek, todayIn } from '@/lib/datetime';

export const metadata: Metadata = { title: 'Repas' };

export default async function RepasPage({
  searchParams,
}: {
  searchParams: Promise<{ semaine?: string }>;
}) {
  const params = await searchParams;
  const { household } = await requireHousehold();
  const supabase = await createClient();

  const monday = /^\d{4}-\d{2}-\d{2}$/.test(params.semaine ?? '')
    ? startOfWeek(params.semaine!)
    : startOfWeek(todayIn(household.timezone));

  const sunday = addDays(monday, 6);

  const [mealsResult, recipesResult, listResult] = await Promise.all([
    supabase
      .from('meals')
      .select('*')
      .eq('household_id', household.id)
      .gte('meal_date', monday)
      .lte('meal_date', sunday)
      .order('meal_date'),
    supabase
      .from('recipes')
      .select('*')
      .eq('household_id', household.id)
      .order('name'),
    supabase
      .from('shopping_lists')
      .select('id')
      .eq('household_id', household.id)
      .order('is_default', { ascending: false })
      .order('created_at')
      .limit(1),
  ]);

  const meals = mealsResult.data ?? [];

  const participants =
    meals.length > 0
      ? ((
          await supabase
            .from('meal_participants')
            .select('meal_id, member_id, child_id')
            .in(
              'meal_id',
              meals.map((m) => m.id),
            )
        ).data ?? [])
      : [];

  return (
    <MealPlanner
      monday={monday}
      meals={meals}
      recipes={recipesResult.data ?? []}
      participants={participants}
      defaultListId={listResult.data?.[0]?.id ?? null}
    />
  );
}
