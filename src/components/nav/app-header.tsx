'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
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
  const pathname = usePathname();

  // Comme la barre de titre d'iOS : le grand titre de l'écran défile avec lui ;
  // quand il a disparu, un titre court prend sa place au centre de la barre,
  // et un filet fin la sépare du contenu qui passe dessous.
  const [title, setTitle] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    const heading = document.querySelector('main h1');
    setCollapsed(false);
    setTitle(null);
    if (!heading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const gone = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        if (gone) setTitle(heading.textContent?.trim() || null);
        setCollapsed(gone);
      },
      // La barre mesure environ 56 px : le titre est « parti » dès qu'elle le recouvre.
      { rootMargin: '-56px 0px 0px 0px' },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] backdrop-blur-xl backdrop-saturate-150 transition-[border-color] md:hidden',
        collapsed ? 'border-[var(--line)]' : 'border-transparent',
      )}
    >
      <div className="relative mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-1.5">
        <p
          className={cn(
            'min-w-0 truncate text-sm font-semibold text-[var(--fg-muted)] transition-opacity duration-150',
            collapsed && 'opacity-0',
          )}
        >
          {household.name}
        </p>

        {/* Doublon de l'<h1> pour l'œil : masqué aux lecteurs d'écran. */}
        <p
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-20 truncate text-center text-[1.0625rem] font-semibold transition-opacity duration-150',
            collapsed ? 'opacity-100' : 'opacity-0',
          )}
        >
          {title}
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
