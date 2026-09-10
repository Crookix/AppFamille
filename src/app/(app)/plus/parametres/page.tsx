import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppSettings } from '@/components/settings/app-settings';

export const metadata: Metadata = { title: 'Paramètres' };

export default async function ParametresPage() {
  const { member } = await requireHousehold();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', member.user_id)
    .maybeSingle();

  return (
    <AppSettings
      email={profile?.email ?? null}
      demoEnabled={process.env.NEXT_PUBLIC_ENABLE_DEMO === '1'}
    />
  );
}
