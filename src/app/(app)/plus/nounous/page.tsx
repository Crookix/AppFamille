import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { NanniesManager } from '@/components/childcare/nannies-manager';

export const metadata: Metadata = { title: 'Nounous' };

export default async function NounousPage() {
  const { household } = await requireHousehold();
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [nanniesResult, ratesResult, toConfirmResult, upcomingResult] = await Promise.all([
    supabase
      .from('nannies')
      .select('*')
      .eq('household_id', household.id)
      .eq('is_active', true)
      .order('name'),
    supabase.from('nanny_rates').select('*').eq('household_id', household.id),
    // Gardes terminées dont les heures ne sont pas encore confirmées.
    supabase
      .from('childcare_sessions')
      .select('*')
      .eq('household_id', household.id)
      .in('status', ['prevue', 'a_confirmer'])
      .lt('scheduled_end', now)
      .order('scheduled_start', { ascending: false })
      .limit(20),
    supabase
      .from('childcare_sessions')
      .select('*')
      .eq('household_id', household.id)
      .in('status', ['prevue', 'a_confirmer'])
      .gte('scheduled_end', now)
      .order('scheduled_start')
      .limit(10),
  ]);

  const toConfirm = toConfirmResult.data ?? [];

  const extras =
    toConfirm.length > 0
      ? ((
          await supabase
            .from('childcare_extras')
            .select('*')
            .in(
              'session_id',
              toConfirm.map((s) => s.id),
            )
        ).data ?? [])
      : [];

  return (
    <NanniesManager
      nannies={nanniesResult.data ?? []}
      rates={ratesResult.data ?? []}
      toConfirm={toConfirm}
      upcoming={upcomingResult.data ?? []}
      extras={extras}
    />
  );
}
