import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { NotificationCenter } from '@/components/notifications/notification-center';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const { member } = await requireHousehold();
  const supabase = await createClient();

  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', member.user_id)
    .order('created_at', { ascending: false })
    .limit(60);

  return <NotificationCenter notifications={data ?? []} />;
}
