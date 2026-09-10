'use client';

import * as React from 'react';
import { CalendarPlus, Baby, ListPlus, Plus, ShoppingBasket } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { EventSheet } from '@/components/events/event-sheet';
import { TaskSheet } from '@/components/tasks/task-sheet';
import { QuickShoppingSheet } from '@/components/shopping/quick-shopping-sheet';
import { ChildcareSheet } from '@/components/childcare/childcare-sheet';

type Target = 'evenement' | 'tache' | 'course' | 'garde';

const CHOICES: { key: Target; label: string; hint: string; icon: React.ElementType; tone: string }[] = [
  {
    key: 'evenement',
    label: 'Un événement',
    hint: 'Rendez-vous, école, déplacement…',
    icon: CalendarPlus,
    tone: 'bg-brand-100 text-brand-700',
  },
  {
    key: 'tache',
    label: 'Une tâche',
    hint: 'À faire, avec un responsable',
    icon: ListPlus,
    tone: 'bg-sage-100 text-sage-700',
  },
  {
    key: 'course',
    label: 'Une course',
    hint: 'Ajout à la liste partagée',
    icon: ShoppingBasket,
    tone: 'bg-honey-100 text-honey-700',
  },
  {
    key: 'garde',
    label: 'Une garde',
    hint: 'Nounou, horaires, enfants',
    icon: Baby,
    tone: 'bg-[var(--bg-subtle)] text-[var(--fg)]',
  },
];

/**
 * Bouton d'ajout rapide, présent sur tous les écrans.
 *
 * Il ouvre d'abord un choix à quatre entrées plutôt que de deviner ce que l'on
 * veut créer selon la page : le geste reste le même partout, ce qui compte
 * davantage qu'une économie d'un appui.
 */
export function QuickAdd() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [target, setTarget] = React.useState<Target | null>(null);

  function choose(next: Target) {
    setMenuOpen(false);
    setTarget(next);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Ajouter"
        className={[
          'fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-4 z-40',
          'flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white',
          'shadow-lg shadow-brand-500/30 transition-transform active:scale-95 hover:bg-brand-600',
          'md:bottom-8 md:right-8',
        ].join(' ')}
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} aria-hidden />
      </button>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Ajouter">
        <ul className="space-y-2">
          {CHOICES.map(({ key, label, hint, icon: Icon, tone }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => choose(key)}
                className="flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{label}</span>
                  <span className="block text-sm text-muted">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <EventSheet open={target === 'evenement'} onClose={() => setTarget(null)} />
      <TaskSheet open={target === 'tache'} onClose={() => setTarget(null)} />
      <QuickShoppingSheet open={target === 'course'} onClose={() => setTarget(null)} />
      <ChildcareSheet open={target === 'garde'} onClose={() => setTarget(null)} />
    </>
  );
}
