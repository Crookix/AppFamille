import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppSettings } from '@/components/settings/app-settings';

export const metadata: Metadata = { title: 'Paramètres' };

export default async function ParametresPage() {
  const { household, member } = await requireHousehold();
  const supabase = await createClient();

  const [{ data: profile }, { data: preferences }] = await Promise.all([
    supabase.from('profiles').select('email').eq('id', member.user_id).maybeSingle(),
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', member.user_id)
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);

  return (
    <AppSettings
      email={profile?.email ?? null}
      notificationPreferences={preferences ?? null}
      demoEnabled={process.env.NEXT_PUBLIC_ENABLE_DEMO === '1'}
    />
  );
}
