import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadOccurrences, serializeOccurrences } from '@/lib/data/calendar';
import { CalendarView, type CalendarMode } from '@/components/calendar/calendar-view';
import {
  addDays,
  endOfDayIn,
  startOfDayIn,
  startOfMonth,
  startOfWeek,
  todayIn,
} from '@/lib/datetime';

export const metadata: Metadata = { title: 'Calendrier' };

const MODES: CalendarMode[] = ['agenda', 'jour', 'semaine', 'mois'];

/**
 * Fenêtre de chargement selon la vue.
 *
 * Elle est calculée côté serveur pour que la requête ne rapatrie que ce qui
 * sera affiché — un foyer qui utilise l'application depuis des années ne doit
 * pas charger tout son historique pour voir la semaine en cours.
 */
function windowFor(mode: CalendarMode, anchor: string, tz: string) {
  switch (mode) {
    case 'jour':
      return { from: startOfDayIn(anchor, tz), to: endOfDayIn(anchor, tz) };
    case 'semaine': {
      const start = startOfWeek(anchor);
      return { from: startOfDayIn(start, tz), to: endOfDayIn(addDays(start, 6), tz) };
    }
    case 'mois': {
      // La grille affiche aussi les jours débordants du mois précédent et
      // suivant : la fenêtre couvre les six semaines réellement dessinées.
      const gridStart = startOfWeek(startOfMonth(anchor));
      return {
        from: startOfDayIn(gridStart, tz),
        to: endOfDayIn(addDays(gridStart, 41), tz),
      };
    }
    default:
      return {
        from: startOfDayIn(anchor, tz),
        to: endOfDayIn(addDays(anchor, 60), tz),
      };
  }
}

export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; date?: string }>;
}) {
  const params = await searchParams;
  const { household } = await requireHousehold();
  const tz = household.timezone;

  const mode: CalendarMode = MODES.includes(params.vue as CalendarMode)
    ? (params.vue as CalendarMode)
    : 'agenda';

  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? params.date!
    : todayIn(tz);

  const { from, to } = windowFor(mode, anchor, tz);

  // Les deux chargements partent ensemble. Les pièces jointes dépendaient
  // auparavant des occurrences — on attendait donc leur retour avant même de
  // demander la liste. En interrogeant le foyer entier plutôt que les seuls
  // événements affichés, la dépendance disparaît et avec elle un aller-retour :
  // les pièces jointes d'une famille se comptent en dizaines, pas en milliers.
  const supabase = await createClient();
  const [items, attachmentsResult] = await Promise.all([
    loadOccurrences(household.id, from, to),
    supabase
      .from('attachments')
      .select('event_id')
      .eq('household_id', household.id)
      .not('event_id', 'is', null),
  ]);

  const occurrences = serializeOccurrences(items);

  // Quels événements affichés portent une pièce jointe ? Un trombone dans la
  // liste évite d'ouvrir chaque fiche pour retrouver un billet de train.
  const visibles = new Set(occurrences.map((o) => o.event.id));
  const attachmentEventIds = [
    ...new Set(
      (attachmentsResult.data ?? [])
        .map((a) => a.event_id)
        .filter((id): id is string => Boolean(id) && visibles.has(id!)),
    ),
  ];

  return (
    <CalendarView
      occurrences={occurrences}
      mode={mode}
      anchorDay={anchor}
      attachmentEventIds={attachmentEventIds}
    />
  );
}
