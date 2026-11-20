'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
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
 * « Plus » reste dans l'entête sur téléphone et dans la colonne sur ordinateur.
 */
const TABS = [
  { href: '/', label: 'Accueil', icon: House },
  { href: '/calendrier', label: 'Calendrier', icon: CalendarDays },
  { href: '/listes', label: 'Listes', icon: ListChecks },
  { href: '/repas', label: 'Repas', icon: UtensilsCrossed },
  { href: '/recettes', label: 'Recette', icon: BookOpen },
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
        'fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-elevated)_80%,transparent)] backdrop-blur-xl backdrop-saturate-150',
        'safe-bottom pt-1.5',
        'md:inset-y-0 md:right-auto md:left-0 md:w-64 md:border-r md:border-t-0 md:px-3 md:py-6',
      )}
    >
      <div className="hidden px-3 pb-6 md:block">
        <p className="text-xl font-bold tracking-tight">
          <span className="text-[var(--accent-text)]">MyFamily</span>
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
              className={cn('min-w-0 flex-1 md:flex-none', sidebarOnly && 'hidden md:block')}
            >
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full min-h-11 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[0.6875rem] font-semibold transition-colors',
                  'md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-[0.95rem]',
                  active
                    ? 'text-[var(--accent-text)] md:bg-brand-50'
                    : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                <span className="flex h-7 items-center justify-center md:h-auto">
                  <Icon className="h-[1.3rem] w-[1.3rem]" strokeWidth={active ? 2.5 : 2} aria-hidden />
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
