import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isEncryptionConfigured } from '@/lib/google/crypto';
import { isGoogleConfigured } from '@/lib/google/oauth';
import { isPushSupported } from '@/lib/google/watch';
import { describeCronSchedule } from '@/lib/google/schedule';
// La planification est lue là où Vercel la lit. L'écran a déjà annoncé une
// cadence que le forfait refusait de produire : une seule source, désormais.
import vercelConfig from '../../../../../vercel.json';
import { GoogleSettings } from '@/components/google/google-settings';

export const metadata: Metadata = { title: 'Google Agenda' };

export default async function GooglePage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; connecte?: string }>;
}) {
  const params = await searchParams;
  const { household, member } = await requireHousehold();
  const supabase = await createClient();

  const { data: account } = await supabase
    .from('google_accounts')
    .select('*')
    .eq('user_id', member.user_id)
    .maybeSingle();

  const [calendarsResult, runsResult, channelsResult] = await Promise.all([
    account
      ? supabase
          .from('google_calendars')
          .select('*')
          .eq('google_account_id', account.id)
          .eq('household_id', household.id)
          .order('is_primary', { ascending: false })
          .order('summary')
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from('google_sync_runs')
      .select('*')
      .eq('household_id', household.id)
      .order('started_at', { ascending: false })
      .limit(10),
    // Les canaux de notification : lecture seule pour les membres du foyer,
    // le temps de dire à l'écran si Google prévient MyFamily tout seul.
    supabase.from('google_watch_channels').select('*').eq('household_id', household.id),
  ]);

  return (
    <GoogleSettings
      configured={isGoogleConfigured()}
      encryptionConfigured={isEncryptionConfigured()}
      serviceKeyPresent={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
      account={account ?? null}
      calendars={calendarsResult.data ?? []}
      runs={runsResult.data ?? []}
      channels={channelsResult.data ?? []}
      pushSupported={isPushSupported()}
      scheduledSyncConfigured={Boolean(process.env.CRON_SECRET)}
      scheduleLabel={describeCronSchedule(
        vercelConfig.crons?.find((cron) => cron.path === '/api/google/cron')?.schedule,
      )}
      initialError={params.erreur ?? null}
      justConnected={params.connecte === '1'}
    />
  );
}
