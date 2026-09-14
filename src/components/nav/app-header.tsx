'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { useHousehold } from '@/components/providers/household-provider';

/**
 * Entête des écrans connectés, sur téléphone uniquement.
 *
 * Il porte ce que la barre du bas a cessé de porter : l'accès aux réglages,
 * derrière la pastille d'identité. C'est la contrepartie du choix fait dans
 * `bottom-nav.tsx` — les cinq places de la barre vont aux destinations, et
 * « Plus » se rejoint depuis n'importe quel écran en un appui, ici.
 *
 * Deux gains au passage. Le nom du foyer devient visible partout, alors qu'il
 * ne l'était que sur « Plus » : qui appartient à deux foyers voit enfin lequel
 * il regarde. Et la pastille porte une puce quand des notifications attendent,
 * ce qu'aucun écran ne disait jusqu'ici — sans elle, éloigner « Plus » aurait
 * éloigné les notifications avec.
 *
 * Sur grand écran, la colonne latérale fait déjà tout cela : l'entête disparaît.
 */
export function AppHeader({ unread }: { unread: number }) {
  const { household, me } = useHousehold();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/90 backdrop-blur md:hidden">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-1.5">
        <p className="min-w-0 truncate text-sm font-semibold text-[var(--fg-muted)]">
          {household.name}
        </p>

        <Link
          href="/plus"
          aria-label={
            unread > 0
              ? `Plus et réglages — ${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}`
              : 'Plus et réglages'
          }
          className="relative -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-subtle)]"
        >
          <Avatar name={me.display_name} color={me.color} size="sm" />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-[var(--bg)]"
            />
          ) : null}
        </Link>
      </div>
    </header>
  );
}
