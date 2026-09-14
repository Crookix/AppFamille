'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  House,
  ListChecks,
  MoreHorizontal,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Les entrées de la navigation.
 *
 * `sidebarOnly` distingue les deux natures qui cohabitaient jusqu'ici dans la
 * même barre : cinq DESTINATIONS, où l'on va faire quelque chose plusieurs fois
 * par jour, et « Plus », un tiroir de réglages qu'on ouvre une fois par mois.
 * Le tiroir occupait un cinquième de la surface la plus précieuse de
 * l'application — c'est ce qui avait repoussé la reco deux appuis plus loin.
 *
 * Sur téléphone il quitte donc la barre pour l'entête ; sur grand écran la
 * colonne de 256 px n'a aucune rareté à arbitrer et le garde.
 */
const TABS = [
  { href: '/', label: 'Accueil', icon: House },
  { href: '/calendrier', label: 'Calendrier', icon: CalendarDays },
  { href: '/listes', label: 'Listes', icon: ListChecks },
  { href: '/repas', label: 'Repas', icon: UtensilsCrossed },
  { href: '/reco', label: 'Reco', icon: Sparkles },
  { href: '/plus', label: 'Plus', icon: MoreHorizontal, sidebarOnly: true },
] as const;

/**
 * Barre de navigation principale, fixée en bas sur téléphone et passée en
 * colonne latérale sur grand écran.
 */
export function BottomNav({ householdName }: { householdName: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--bg-elevated)]/95 backdrop-blur',
        'safe-bottom pt-1',
        'md:inset-y-0 md:right-auto md:left-0 md:w-64 md:border-r md:border-t-0 md:px-3 md:py-6',
      )}
    >
      <div className="hidden px-3 pb-6 md:block">
        <p className="text-xl font-extrabold tracking-tight">
          <span className="text-brand-500">MyFamily</span>
        </p>
        <p className="mt-0.5 truncate text-sm text-muted">{householdName}</p>
      </div>

      <ul className="flex items-stretch justify-around md:flex-col md:gap-1">
        {TABS.map((tab) => {
          const { href, label, icon: Icon } = tab;
          const sidebarOnly = 'sidebarOnly' in tab && tab.sidebarOnly;
          const active =
            href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li
              key={href}
              className={cn('flex-1 md:flex-none', sidebarOnly && 'hidden md:block')}
            >
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[0.68rem] font-semibold transition-colors',
                  'md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-[0.95rem]',
                  active
                    ? 'text-brand-600 md:bg-brand-50 dark:md:bg-white/5'
                    : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-11 items-center justify-center rounded-full transition-colors md:h-auto md:w-auto',
                    active ? 'bg-brand-100 md:bg-transparent dark:bg-white/10' : '',
                  )}
                >
                  <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={active ? 2.6 : 2} aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
