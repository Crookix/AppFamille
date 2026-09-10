import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadOccurrences, serializeOccurrences } from '@/lib/data/calendar';
import { ChildProfile } from '@/components/children/child-profile';
import { addDays, endOfDayIn, startOfDayIn, todayIn } from '@/lib/datetime';

export const metadata: Metadata = { title: 'Fiche enfant' };

export default async function EnfantPage({
  params,
}: {
  params: Promise<{ childId: string }>;
}) {
  const { childId } = await params;
  const { household } = await requireHousehold();
  const supabase = await createClient();
  const tz = household.timezone;
  const today = todayIn(tz);

  const { data: child } = await supabase
    .from('children')
    .select('*')
    .eq('id', childId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!child) notFound();

  const [activitiesResult, occurrences, linksResult] = await Promise.all([
    supabase
      .from('child_activities')
      .select('*')
      .eq('child_id', childId)
      .order('weekday', { nullsFirst: false }),
    loadOccurrences(
      household.id,
      startOfDayIn(today, tz),
      endOfDayIn(addDays(today, 30), tz),
    ),
    supabase
      .from('childcare_session_children')
      .select('session_id')
      .eq('child_id', childId)
      .limit(200),
  ]);

  // Les événements où l'enfant est explicitement associé.
  const events = serializeOccurrences(occurrences)
    .filter((item) => item.childIds.includes(childId))
    .slice(0, 10);

  // Deux requêtes plutôt qu'une jointure imbriquée : PostgREST sait la faire,
  // mais elle n'est pas typable de façon fiable côté client.
  const sessionIds = (linksResult.data ?? []).map((row) => row.session_id);

  const sessionsResult =
    sessionIds.length > 0
      ? await supabase
          .from('childcare_sessions')
          .select('id, scheduled_start, scheduled_end, nanny_id')
          .in('id', sessionIds)
          .gte('scheduled_end', new Date().toISOString())
          .order('scheduled_start')
          .limit(5)
      : { data: [] };

  const rawSessions = sessionsResult.data ?? [];
  const nannyIds = [...new Set(rawSessions.map((s) => s.nanny_id))];

  const nanniesResult =
    nannyIds.length > 0
      ? await supabase.from('nannies').select('id, name').in('id', nannyIds)
      : { data: [] };

  const nanniesById = new Map((nanniesResult.data ?? []).map((n) => [n.id, n]));

  const sessions = rawSessions.map((session) => ({
    id: session.id,
    scheduled_start: session.scheduled_start,
    scheduled_end: session.scheduled_end,
    nanny: nanniesById.get(session.nanny_id) ?? null,
  }));

  return (
    <ChildProfile
      child={child}
      activities={activitiesResult.data ?? []}
      events={events}
      sessions={sessions}
    />
  );
}
