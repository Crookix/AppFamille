import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ListsTabs } from '@/components/lists/lists-tabs';

export const metadata: Metadata = { title: 'Listes' };

/**
 * Tâches et courses réunies sous deux onglets, comme demandé : ce sont les
 * deux listes que l'on consulte au même moment de la journée.
 */
export default async function ListesPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string; liste?: string }>;
}) {
  const params = await searchParams;
  const { household } = await requireHousehold();
  const supabase = await createClient();

  const tab = params.onglet === 'courses' ? 'courses' : 'taches';

  const [tasksResult, listsResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('household_id', household.id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('shopping_lists')
      .select('*')
      .eq('household_id', household.id)
      .order('is_default', { ascending: false })
      .order('created_at'),
  ]);

  const allTasks = tasksResult.data ?? [];
  const lists = listsResult.data ?? [];

  const activeListId =
    lists.find((l) => l.id === params.liste)?.id ?? lists[0]?.id ?? null;

  const items = activeListId
    ? ((
        await supabase
          .from('shopping_items')
          .select('*')
          .eq('list_id', activeListId)
          .order('created_at')
      ).data ?? [])
    : [];

  return (
    <ListsTabs
      tab={tab}
      tasks={allTasks.filter((t) => !t.parent_task_id)}
      subtasks={allTasks.filter((t) => t.parent_task_id)}
      items={items}
      lists={lists}
      activeListId={activeListId}
    />
  );
}
