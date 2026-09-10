import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { NotificationCenter } from '@/components/notifications/notification-center';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const { household, member } = await requireHousehold();
  const supabase = await createClient();

  const [notificationsResult, preferencesResult] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', member.user_id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', member.user_id)
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);

  return (
    <NotificationCenter
      notifications={notificationsResult.data ?? []}
      preferences={preferencesResult.data ?? null}
    />
  );
}
