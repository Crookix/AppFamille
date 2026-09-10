import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { expandEvents, type Occurrence } from '@/lib/recurrence';
import type { EventRow, EventParticipantRow } from '@/lib/database.types';

export type EventWithPeople = {
  occurrence: Occurrence;
  memberIds: string[];
  childIds: string[];
};

/**
 * Charge les événements d'une plage, séries déroulées.
 *
 * La requête ratisse volontairement plus large que la fenêtre demandée : un
 * événement maître dont la série s'étend jusqu'à aujourd'hui peut avoir
 * commencé il y a des mois, et une requête bornée à la fenêtre le manquerait.
 * On récupère donc séparément les événements simples qui la chevauchent et
 * TOUS les maîtres récurrents, puis on déroule.
 */
export async function loadOccurrences(
  householdId: string,
  from: Date,
  to: Date,
): Promise<EventWithPeople[]> {
  const supabase = await createClient();

  // Trois requêtes en une seule vague. Ce qui coûte cher n'est pas le nombre
  // de requêtes mais le nombre d'allers-retours : les exceptions étaient
  // auparavant chargées dans un second temps, ce qui ajoutait une traversée
  // complète du réseau pour rien.
  const [plainResult, recurringResult, exceptionsResult] = await Promise.all([
    // Événements simples et exceptions qui chevauchent la fenêtre.
    supabase
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .is('recurrence_rule', null)
      .lt('starts_at', to.toISOString())
      .gt('ends_at', from.toISOString()),
    // Toutes les séries du foyer : c'est le déroulé qui filtrera.
    supabase
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .not('recurrence_rule', 'is', null)
      .lt('starts_at', to.toISOString()),
    // Toutes les exceptions du foyer. On ne peut pas les filtrer sur les
    // séries retenues sans connaître ces séries — d'où le filtrage en mémoire
    // juste après, qui préserve exactement la sémantique précédente.
    supabase
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .not('recurring_parent_id', 'is', null),
  ]);

  const plain = plainResult.data ?? [];
  const recurring = recurringResult.data ?? [];

  // Les exceptions des séries retenues, où qu'elles se trouvent dans le temps.
  const parentIds = new Set(recurring.map((e) => e.id));
  const exceptions = (exceptionsResult.data ?? []).filter(
    (e) => e.recurring_parent_id && parentIds.has(e.recurring_parent_id),
  );

  // `plain` contient déjà certaines exceptions : on déduplique par identifiant.
  const byId = new Map<string, EventRow>();
  for (const event of [...plain, ...recurring, ...exceptions]) {
    byId.set(event.id, event);
  }

  const occurrences = expandEvents([...byId.values()], from, to);

  // Participants des seuls événements réellement affichés.
  const eventIds = [...new Set(occurrences.map((o) => o.event.id))];
  let participants: EventParticipantRow[] = [];

  if (eventIds.length > 0) {
    const { data } = await supabase
      .from('event_participants')
      .select('*')
      .in('event_id', eventIds);
    participants = data ?? [];
  }

  const membersByEvent = new Map<string, string[]>();
  const childrenByEvent = new Map<string, string[]>();

  for (const participant of participants) {
    if (participant.member_id) {
      const list = membersByEvent.get(participant.event_id) ?? [];
      list.push(participant.member_id);
      membersByEvent.set(participant.event_id, list);
    }
    if (participant.child_id) {
      const list = childrenByEvent.get(participant.event_id) ?? [];
      list.push(participant.child_id);
      childrenByEvent.set(participant.event_id, list);
    }
  }

  return occurrences.map((occurrence) => ({
    occurrence,
    memberIds: membersByEvent.get(occurrence.event.id) ?? [],
    childIds: childrenByEvent.get(occurrence.event.id) ?? [],
  }));
}

/** Version sérialisable, pour passer les occurrences à un composant client. */
export type SerializedOccurrence = {
  key: string;
  event: EventRow;
  startsAt: string;
  endsAt: string;
  occurrenceStart: string;
  isRecurring: boolean;
  isException: boolean;
  memberIds: string[];
  childIds: string[];
};

export function serializeOccurrences(items: EventWithPeople[]): SerializedOccurrence[] {
  return items.map(({ occurrence, memberIds, childIds }) => ({
    key: occurrence.key,
    event: occurrence.event,
    startsAt: occurrence.startsAt.toISOString(),
    endsAt: occurrence.endsAt.toISOString(),
    occurrenceStart: occurrence.occurrenceStart.toISOString(),
    isRecurring: occurrence.isRecurring,
    isException: occurrence.isException,
    memberIds,
    childIds,
  }));
}
