import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { HouseholdProvider } from '@/components/providers/household-provider';
import { AppHeader } from '@/components/nav/app-header';
import { BottomNav } from '@/components/nav/bottom-nav';
import { QuickAdd } from '@/components/nav/quick-add';

/**
 * Coque des écrans connectés.
 *
 * Le foyer, ses membres et ses enfants sont chargés ici une seule fois : ces
 * données sont lues par presque tous les écrans et changent rarement.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { household, member, memberships } = await requireHousehold();
  const supabase = await createClient();

  // Trois requêtes, une seule vague : elles ne dépendent pas les unes des
  // autres. Le compteur de non-lues alimente la puce de l'entête.
  const [membersResult, childrenResult, unreadResult] = await Promise.all([
    supabase
      .from('household_members')
      .select('*')
      .eq('household_id', household.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('children')
      .select('*')
      .eq('household_id', household.id)
      .eq('archived', false)
      .order('birth_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', member.user_id)
      .is('read_at', null),
  ]);

  return (
    <HouseholdProvider
      value={{
        household,
        me: member,
        members: membersResult.data ?? [member],
        children: childrenResult.data ?? [],
        isAdmin: member.role === 'admin',
        otherHouseholds: memberships
          .map((m) => m.household)
          .filter((h) => h.id !== household.id),
      }}
    >
      <div className="min-h-dvh md:pl-64">
        <AppHeader unread={unreadResult.count ?? 0} />
        <main
          id="contenu"
          className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 md:pb-12 md:pt-8"
        >
          {children}
        </main>
        <QuickAdd />
        <BottomNav householdName={household.name} />
      </div>
    </HouseholdProvider>
  );
}
