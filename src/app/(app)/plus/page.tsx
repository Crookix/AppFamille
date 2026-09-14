import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Baby,
  Bell,
  CalendarCheck,
  ChevronRight,
  Home,
  Settings,
  Users,
} from 'lucide-react';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Plus' };

export default async function PlusPage() {
  const { household, member } = await requireHousehold();
  const supabase = await createClient();

  const [childrenResult, nanniesResult, unreadResult] = await Promise.all([
    supabase
      .from('children')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', household.id)
      .eq('archived', false),
    supabase
      .from('nannies')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', household.id)
      .eq('is_active', true),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', member.user_id)
      .is('read_at', null),
  ]);

  const entries = [
    {
      href: '/plus/enfants',
      label: 'Enfants',
      hint: `${childrenResult.count ?? 0} fiche(s)`,
      icon: Users,
    },
    {
      href: '/plus/nounous',
      label: 'Nounous et gardes',
      hint: `${nanniesResult.count ?? 0} nounou(s)`,
      icon: Baby,
    },
    {
      href: '/plus/notifications',
      label: 'Notifications',
      hint:
        (unreadResult.count ?? 0) > 0
          ? `${unreadResult.count} non lue(s)`
          : 'Tout est lu',
      icon: Bell,
    },
    {
      href: '/plus/google',
      label: 'Google Agenda',
      hint: 'Connexion et synchronisation',
      icon: CalendarCheck,
    },
    { href: '/plus/foyer', label: 'Le foyer', hint: household.name, icon: Home },
    {
      href: '/plus/parametres',
      label: 'Paramètres',
      hint: 'Profil, apparence, compte',
      icon: Settings,
    },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-extrabold tracking-tight">Plus</h1>

      <Card className="divide-y divide-[var(--line)] p-0">
        {entries.map(({ href, label, hint, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3.5 px-4 py-3.5 transition-colors first:rounded-t-[var(--radius-xl2)] last:rounded-b-[var(--radius-xl2)] hover:bg-[var(--bg-subtle)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-white/5">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{label}</span>
              <span className="block truncate text-sm text-muted">{hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          </Link>
        ))}
      </Card>

      <p className="mt-6 text-center text-xs text-muted">
        MyFamily · foyer « {household.name} »
      </p>
    </div>
  );
}
