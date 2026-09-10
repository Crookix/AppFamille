import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { loadOccurrences, serializeOccurrences } from '@/lib/data/calendar';
import { addDays, endOfDayIn, startOfDayIn, todayIn } from '@/lib/datetime';
import type {
  ChildcareSessionRow,
  MealRow,
  NannyRow,
  ShoppingItemRow,
  ShoppingListRow,
  TaskRow,
} from '@/lib/database.types';
import type { SerializedOccurrence } from '@/lib/data/calendar';

export type DashboardData = {
  today: string;
  todayEvents: SerializedOccurrence[];
  upcomingEvents: SerializedOccurrence[];
  todayTasks: TaskRow[];
  overdueTasks: TaskRow[];
  dinner: MealRow | null;
  lunch: MealRow | null;
  openItems: ShoppingItemRow[];
  openItemCount: number;
  defaultList: ShoppingListRow | null;
  nextChildcare: (ChildcareSessionRow & { nanny: NannyRow | null }) | null;
  childcareToConfirm: number;
};

/**
 * Rassemble tout ce dont l'accueil a besoin, en une passe.
 *
 * L'écran répond à trois questions : qu'est-ce qui est prévu, qui s'en occupe,
 * qu'est-ce qu'il reste à faire. Toutes les requêtes partent en parallèle :
 * elles sont indépendantes, et l'accueil est l'écran le plus consulté.
 */
export async function loadDashboard(
  householdId: string,
  timezone: string,
): Promise<DashboardData> {
  const supabase = await createClient();
  const today = todayIn(timezone);

  const dayStart = startOfDayIn(today, timezone);
  const dayEnd = endOfDayIn(today, timezone);
  const horizon = endOfDayIn(addDays(today, 7), timezone);

  const [
    occurrences,
    tasksResult,
    mealsResult,
    listResult,
    childcareResult,
    toConfirmResult,
  ] = await Promise.all([
    loadOccurrences(householdId, dayStart, horizon),

    // Tâches à faire aujourd'hui, sans date, ou en retard.
    supabase
      .from('tasks')
      .select('*')
      .eq('household_id', householdId)
      .neq('status', 'termine')
      .is('parent_task_id', null)
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .limit(50),

    supabase
      .from('meals')
      .select('*')
      .eq('household_id', householdId)
      .eq('meal_date', today),

    supabase
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .order('is_default', { ascending: false })
      .order('created_at')
      .limit(1),

    supabase
      .from('childcare_sessions')
      .select('*, nanny:nannies(*)')
      .eq('household_id', householdId)
      .in('status', ['prevue', 'a_confirmer'])
      .gte('scheduled_end', new Date().toISOString())
      .order('scheduled_start', { ascending: true })
      .limit(1),

    // Gardes passées dont les heures restent à confirmer.
    supabase
      .from('childcare_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .in('status', ['prevue', 'a_confirmer'])
      .lt('scheduled_end', new Date().toISOString()),
  ]);

  const serialized = serializeOccurrences(occurrences);
  const todayEnd = dayEnd.getTime();

  const todayEvents = serialized.filter(
    (item) => new Date(item.startsAt).getTime() < todayEnd,
  );
  const upcomingEvents = serialized
    .filter((item) => new Date(item.startsAt).getTime() >= todayEnd)
    .slice(0, 5);

  const tasks = tasksResult.data ?? [];
  const todayTasks = tasks.filter((task) => !task.due_date || task.due_date >= today);
  const overdueTasks = tasks.filter((task) => task.due_date && task.due_date < today);

  const meals = mealsResult.data ?? [];
  const defaultList = listResult.data?.[0] ?? null;

  let openItems: ShoppingItemRow[] = [];
  let openItemCount = 0;

  if (defaultList) {
    const { data, count } = await supabase
      .from('shopping_items')
      .select('*', { count: 'exact' })
      .eq('list_id', defaultList.id)
      .eq('is_checked', false)
      .order('aisle')
      .limit(5);
    openItems = data ?? [];
    openItemCount = count ?? openItems.length;
  }

  const childcare = childcareResult.data?.[0] ?? null;

  return {
    today,
    todayEvents,
    upcomingEvents,
    todayTasks,
    overdueTasks,
    dinner: meals.find((m) => m.slot === 'diner') ?? null,
    lunch: meals.find((m) => m.slot === 'dejeuner') ?? null,
    openItems,
    openItemCount,
    defaultList,
    nextChildcare: childcare as DashboardData['nextChildcare'],
    childcareToConfirm: toConfirmResult.count ?? 0,
  };
}
