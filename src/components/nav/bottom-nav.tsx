'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, House, ListChecks, MoreHorizontal, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/', label: 'Accueil', icon: House },
  { href: '/calendrier', label: 'Calendrier', icon: CalendarDays },
  { href: '/listes', label: 'Listes', icon: ListChecks },
  { href: '/repas', label: 'Repas', icon: UtensilsCrossed },
  { href: '/plus', label: 'Plus', icon: MoreHorizontal },
] as const;

/**
 * Barre de navigation principale, fixée en bas sur téléphone et passée en
 * colonne latérale sur grand écran.
 */
export function BottomNav() {
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
      <p className="hidden px-3 pb-6 text-xl font-extrabold tracking-tight md:block">
        <span className="text-brand-500">MyFamily</span>
      </p>

      <ul className="flex items-stretch justify-around md:flex-col md:gap-1">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href} className="flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[0.68rem] font-semibold transition-colors',
                  'md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-[0.95rem]',
                  active
                    ? 'text-brand-600 md:bg-brand-50 dark:md:bg-white/5'
                    : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors md:h-auto md:w-auto',
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
