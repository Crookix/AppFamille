import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { NannyDetail } from '@/components/childcare/nanny-detail';
import { todayIn } from '@/lib/datetime';

export const metadata: Metadata = { title: 'Fiche nounou' };

export default async function NannyPage({
  params,
  searchParams,
}: {
  params: Promise<{ nannyId: string }>;
  searchParams: Promise<{ mois?: string }>;
}) {
  const { nannyId } = await params;
  const { mois } = await searchParams;
  const { household } = await requireHousehold();
  const supabase = await createClient();

  const { data: nanny } = await supabase
    .from('nannies')
    .select('*')
    .eq('id', nannyId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!nanny) notFound();

  const monthPrefix = /^\d{4}-\d{2}$/.test(mois ?? '')
    ? mois!
    : todayIn(household.timezone).slice(0, 7);

  const month = `${monthPrefix}-01`;
  const [year, monthNumber] = monthPrefix.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString();

  const [ratesResult, sessionsResult, settlementResult] = await Promise.all([
    supabase
      .from('nanny_rates')
      .select('*')
      .eq('nanny_id', nannyId)
      .order('effective_from', { ascending: false }),
    supabase
      .from('childcare_sessions')
      .select('*')
      .eq('household_id', household.id)
      .eq('nanny_id', nannyId)
      .gte('scheduled_start', `${month}T00:00:00.000Z`)
      .lt('scheduled_start', nextMonth)
      .order('scheduled_start'),
    supabase
      .from('nanny_settlements')
      .select('*')
      .eq('nanny_id', nannyId)
      .eq('month', month)
      .maybeSingle(),
  ]);

  const sessions = sessionsResult.data ?? [];
  const sessionIds = sessions.map((s) => s.id);

  const [extrasResult, childrenResult] = await Promise.all([
    sessionIds.length > 0
      ? supabase.from('childcare_extras').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as never[] }),
    sessionIds.length > 0
      ? supabase
          .from('childcare_session_children')
          .select('session_id, child_id')
          .in('session_id', sessionIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  return (
    <NannyDetail
      nanny={nanny}
      rates={ratesResult.data ?? []}
      month={month}
      sessions={sessions}
      extras={extrasResult.data ?? []}
      sessionChildren={childrenResult.data ?? []}
      settlement={settlementResult.data ?? null}
    />
  );
}
