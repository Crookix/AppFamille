import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ChildrenManager } from '@/components/children/children-manager';

export const metadata: Metadata = { title: 'Enfants' };

export default async function EnfantsPage() {
  const { household } = await requireHousehold();
  const supabase = await createClient();

  const { data } = await supabase
    .from('children')
    .select('*')
    .eq('household_id', household.id)
    .eq('archived', true)
    .order('first_name');

  return <ChildrenManager archived={data ?? []} />;
}
