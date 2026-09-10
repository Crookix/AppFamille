import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { HouseholdSettings } from '@/components/household/household-settings';

export const metadata: Metadata = { title: 'Le foyer' };

export default async function FoyerPage() {
  const { household } = await requireHousehold();
  const supabase = await createClient();

  const [invitationsResult, membersResult] = await Promise.all([
    supabase
      .from('invitations')
      .select('*')
      .eq('household_id', household.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('household_members')
      .select('user_id')
      .eq('household_id', household.id),
  ]);

  const userIds = (membersResult.data ?? []).map((m) => m.user_id);

  const profilesResult =
    userIds.length > 0
      ? await supabase.from('profiles').select('*').in('id', userIds)
      : { data: [] };

  return (
    <HouseholdSettings
      invitations={invitationsResult.data ?? []}
      profiles={profilesResult.data ?? []}
    />
  );
}
