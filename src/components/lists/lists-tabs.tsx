'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBasket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/primitives';
import { TaskList } from '@/components/tasks/task-list';
import { ShoppingList } from '@/components/shopping/shopping-list';
import { ChecklistsPanel } from '@/components/checklists/checklists-panel';
import type { ShoppingItemRow, ShoppingListRow, TaskRow } from '@/lib/database.types';
import type { ChecklistWithItems } from '@/lib/data/checklists';

export type ListsTab = 'taches' | 'courses' | 'checklists';

export function ListsTabs({
  tab,
  tasks,
  subtasks,
  items,
  lists,
  activeListId,
  checklists,
}: {
  tab: ListsTab;
  tasks: TaskRow[];
  subtasks: TaskRow[];
  items: ShoppingItemRow[];
  lists: ShoppingListRow[];
  activeListId: string | null;
  checklists: ChecklistWithItems[];
}) {
  const router = useRouter();

  const openTasks = tasks.filter((t) => t.status !== 'termine').length;
  const openItems = items.filter((i) => !i.is_checked).length;
  // Une check-list entamée est ce qui demande attention : ni celle qu'on n'a
  // pas commencée, ni celle qui est prête.
  const enCours = checklists.filter(
    (c) => c.items.some((i) => i.is_checked) && c.items.some((i) => !i.is_checked),
  ).length;

  function switchTab(next: ListsTab) {
    router.push(`/listes?onglet=${next}`);
  }

  return (
    <div>
      <h1 className="mb-3 text-xl font-extrabold tracking-tight">Listes</h1>

      <div
        role="tablist"
        aria-label="Tâches, courses ou check-lists"
        // Les trois onglets tiennent côte à côte à 375 px, et c'est la seule
        // disposition acceptable : un onglet qu'il faut faire défiler pour
        // découvrir n'existe pas pour qui ignore qu'il est là — la question
        // « je ne vois pas les check-lists, elles sont où ? » est venue de là.
        //
        // La place a été prise sur les icônes. Elles n'apprenaient rien à côté
        // d'un libellé lisible, et coûtaient vingt-quatre pixels chacune ; le
        // sélecteur de vues du calendrier s'en passe déjà. Le compte perd sa
        // pastille pour la même raison, et reste lisible.
        className="mb-4 flex gap-1 rounded-full bg-[var(--bg-subtle)] p-1 md:max-w-md"
      >
        {(
          [
            { key: 'taches', label: 'Tâches', count: openTasks },
            { key: 'courses', label: 'Courses', count: openItems },
            { key: 'checklists', label: 'Check-lists', count: enCours },
          ] as const
        ).map(({ key, label, count }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={cn(
              'flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 text-[0.8rem] font-semibold transition-colors',
              tab === key
                ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm'
                : 'text-[var(--fg-muted)]',
            )}
          >
            <span className="truncate">{label}</span>
            {count > 0 ? (
              <span
                className={cn(
                  'text-[0.7rem] font-bold tabular-nums',
                  tab === key ? 'text-brand-600' : 'text-[var(--fg-muted)]',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'checklists' ? (
        <ChecklistsPanel initial={checklists} />
      ) : tab === 'taches' ? (
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
