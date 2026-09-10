'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, ShoppingBasket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/primitives';
import { TaskList } from '@/components/tasks/task-list';
import { ShoppingList } from '@/components/shopping/shopping-list';
import type { ShoppingItemRow, ShoppingListRow, TaskRow } from '@/lib/database.types';

export function ListsTabs({
  tab,
  tasks,
  subtasks,
  items,
  lists,
  activeListId,
}: {
  tab: 'taches' | 'courses';
  tasks: TaskRow[];
  subtasks: TaskRow[];
  items: ShoppingItemRow[];
  lists: ShoppingListRow[];
  activeListId: string | null;
}) {
  const router = useRouter();

  const openTasks = tasks.filter((t) => t.status !== 'termine').length;
  const openItems = items.filter((i) => !i.is_checked).length;

  function switchTab(next: 'taches' | 'courses') {
    router.push(`/listes?onglet=${next}`);
  }

  return (
    <div>
      <h1 className="mb-3 text-xl font-extrabold tracking-tight">Listes</h1>

      <div
        role="tablist"
        aria-label="Tâches ou courses"
        className="mb-4 flex gap-1 rounded-full bg-[var(--bg-subtle)] p-1"
      >
        {(
          [
            { key: 'taches', label: 'Tâches', icon: ListChecks, count: openTasks },
            { key: 'courses', label: 'Courses', icon: ShoppingBasket, count: openItems },
          ] as const
        ).map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={cn(
              'flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors',
              tab === key
                ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm'
                : 'text-[var(--fg-muted)]',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {count > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.65rem] font-bold',
                  tab === key ? 'bg-brand-100 text-brand-700' : 'bg-[var(--bg-elevated)]',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'taches' ? (
        <TaskList initialTasks={tasks} subtasks={subtasks} />
      ) : activeListId ? (
        <ShoppingList initialItems={items} lists={lists} activeListId={activeListId} />
      ) : (
        <EmptyState
          icon={<ShoppingBasket className="h-7 w-7" aria-hidden />}
          title="Aucune liste"
          description="La liste de courses du foyer sera créée automatiquement au premier ajout."
          className="surface"
        />
      )}
    </div>
  );
}
