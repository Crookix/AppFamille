import { RRule, rrulestr } from 'rrule';
import type { EventRow } from '@/lib/database.types';
import { DEFAULT_TZ, fromWallClock, toWallClock } from '@/lib/datetime';

/**
 * Une occurrence concrète d'un événement.
 *
 * `occurrenceStart` est la date d'origine de l'occurrence dans la série : c'est
 * elle qui identifie l'occurrence, y compris lorsqu'une exception l'a déplacée.
 * Elle sert de clé pour « modifier uniquement cette occurrence ».
 */
export type Occurrence = {
  event: EventRow;
  startsAt: Date;
  endsAt: Date;
  /** Début théorique dans la série ; égal à `startsAt` hors série. */
  occurrenceStart: Date;
  isRecurring: boolean;
  isException: boolean;
  /** Clé stable d'une occurrence : `<id maître>@<ISO du début théorique>`. */
  key: string;
};

export function occurrenceKey(eventId: string, occurrenceStart: Date): string {
  return `${eventId}@${occurrenceStart.toISOString()}`;
}

export function parseOccurrenceKey(key: string): { eventId: string; occurrenceStart: Date } | null {
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;
  const date = new Date(key.slice(at + 1));
  if (Number.isNaN(date.getTime())) return null;
  return { eventId: key.slice(0, at), occurrenceStart: date };
}

/** Limite de sécurité : une règle sans fin ne doit pas boucler indéfiniment. */
const MAX_OCCURRENCES = 750;

/**
 * Déroule une règle de récurrence entre deux instants.
 *
 * Le déroulé se fait dans l'espace des « heures murales » (voir datetime.ts) :
 * une règle hebdomadaire à 9 h reste à 9 h après un changement d'heure, au lieu
 * de glisser à 8 h ou 10 h comme le ferait un calcul en UTC.
 */
export function expandRule(
  rule: string,
  seriesStart: Date,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string = DEFAULT_TZ,
): Date[] {
  const wallStart = toWallClock(seriesStart, timezone);

  let rrule: RRule;
  try {
    const options = RRule.parseString(rule.replace(/^RRULE:/i, ''));
    rrule = new RRule({ ...options, dtstart: wallStart });
  } catch {
    // Une règle illisible ne doit pas faire disparaître l'événement :
    // on retombe sur l'occurrence unique de départ.
    return [seriesStart];
  }

  // La fenêtre est élargie d'un jour de chaque côté avant d'être exprimée en
  // heures murales, pour ne pas perdre une occurrence à cause du décalage.
  const from = toWallClock(new Date(rangeStart.getTime() - 86_400_000), timezone);
  const to = toWallClock(new Date(rangeEnd.getTime() + 86_400_000), timezone);

  const wallOccurrences = rrule.between(from, to, true).slice(0, MAX_OCCURRENCES);
  return wallOccurrences.map((wall) => fromWallClock(wall, timezone));
}

/** Deux instants se recouvrent-ils sur la fenêtre demandée ? */
function overlaps(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return start < rangeEnd && end > rangeStart;
}

/**
 * Transforme une liste d'événements bruts en occurrences affichables sur une
 * fenêtre donnée.
 *
 * `events` doit contenir aussi bien les événements maîtres que leurs
 * exceptions : les exceptions remplacent l'occurrence correspondante, et
 * celles marquées annulées la font disparaître.
 */
export function expandEvents(
  events: EventRow[],
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  const exceptionsByParent = new Map<string, Map<string, EventRow>>();

  for (const event of events) {
    if (!event.recurring_parent_id || !event.original_starts_at) continue;
    const key = new Date(event.original_starts_at).toISOString();
    const bucket = exceptionsByParent.get(event.recurring_parent_id) ?? new Map();
    bucket.set(key, event);
    exceptionsByParent.set(event.recurring_parent_id, bucket);
  }

  const result: Occurrence[] = [];

  for (const event of events) {
    // Les exceptions sont traitées avec leur série, pas isolément.
    if (event.recurring_parent_id) continue;

    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);

    if (!event.recurrence_rule) {
      if (!event.is_cancelled && overlaps(start, end, rangeStart, rangeEnd)) {
        result.push({
          event,
          startsAt: start,
          endsAt: end,
          occurrenceStart: start,
          isRecurring: false,
          isException: false,
          key: occurrenceKey(event.id, start),
        });
      }
      continue;
    }

    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const exceptions = exceptionsByParent.get(event.id);
    const starts = expandRule(
      event.recurrence_rule,
      start,
      rangeStart,
      rangeEnd,
      event.timezone,
    );

    for (const occurrenceStart of starts) {
      const exception = exceptions?.get(occurrenceStart.toISOString());

      if (exception) {
        // Occurrence supprimée de la série.
        if (exception.is_cancelled) continue;

        const exStart = new Date(exception.starts_at);
        const exEnd = new Date(exception.ends_at);
        if (!overlaps(exStart, exEnd, rangeStart, rangeEnd)) continue;

        result.push({
          event: exception,
          startsAt: exStart,
          endsAt: exEnd,
          occurrenceStart,
          isRecurring: true,
          isException: true,
          key: occurrenceKey(event.id, occurrenceStart),
        });
        continue;
      }

      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
      if (!overlaps(occurrenceStart, occurrenceEnd, rangeStart, rangeEnd)) continue;

      result.push({
        event,
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        occurrenceStart,
        isRecurring: true,
        isException: false,
        key: occurrenceKey(event.id, occurrenceStart),
      });
    }
  }

  result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return result;
}

/* -------------------------------------------------------------------------- */
/* Construction et lecture des règles                                         */
/* -------------------------------------------------------------------------- */

export type RecurrencePreset =
  | { type: 'aucune' }
  | { type: 'quotidienne' }
  | { type: 'hebdomadaire' }
  | { type: 'jours'; weekdays: number[] } // 0 = lundi … 6 = dimanche
  | { type: 'toutes_deux_semaines' }
  | { type: 'mensuelle' }
  | { type: 'personnalisee'; rule: string };

const RRULE_WEEKDAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

/** Construit une RRULE à partir d'un choix d'interface. */
export function buildRecurrenceRule(
  preset: RecurrencePreset,
  until?: Date | null,
): string | null {
  if (preset.type === 'aucune') return null;
  if (preset.type === 'personnalisee') return preset.rule || null;

  const base: Partial<RRule['options']> & { freq: number } = (() => {
    switch (preset.type) {
      case 'quotidienne':
        return { freq: RRule.DAILY };
      case 'hebdomadaire':
        return { freq: RRule.WEEKLY };
      case 'toutes_deux_semaines':
        return { freq: RRule.WEEKLY, interval: 2 };
      case 'mensuelle':
        return { freq: RRule.MONTHLY };
      case 'jours':
        return {
          freq: RRule.WEEKLY,
          byweekday: preset.weekdays.map((d) => RRULE_WEEKDAYS[d]),
        };
    }
  })();

  const rule = new RRule({ ...base, ...(until ? { until } : {}) });
  // On ne conserve que la ligne RRULE : le DTSTART vient de l'événement.
  return rule.toString().replace(/^DTSTART[^\n]*\n?/i, '').replace(/^RRULE:/i, '');
}

const FR_WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Décrit une règle en français, pour l'afficher dans la fiche d'un événement. */
export function describeRecurrence(rule: string | null | undefined): string | null {
  if (!rule) return null;

  let parsed: RRule;
  try {
    parsed = rrulestr(rule.startsWith('RRULE:') ? rule : `RRULE:${rule}`) as RRule;
  } catch {
    return 'Répétition personnalisée';
  }

  const { freq, interval = 1, byweekday, until, count } = parsed.options;

  let text: string;
  if (freq === RRule.DAILY) {
    text = interval === 1 ? 'Tous les jours' : `Tous les ${interval} jours`;
  } else if (freq === RRule.WEEKLY) {
    const days = (byweekday ?? []) as number[];
    if (days.length > 0) {
      const names = days.map((d) => FR_WEEKDAYS[d]).join(', ');
      text = interval === 1 ? `Chaque ${names}` : `Toutes les ${interval} semaines, le ${names}`;
    } else {
      text = interval === 1 ? 'Toutes les semaines' : `Toutes les ${interval} semaines`;
    }
  } else if (freq === RRule.MONTHLY) {
    text = interval === 1 ? 'Tous les mois' : `Tous les ${interval} mois`;
  } else if (freq === RRule.YEARLY) {
    text = interval === 1 ? 'Tous les ans' : `Tous les ${interval} ans`;
  } else {
    text = 'Répétition personnalisée';
  }

  if (count) return `${text}, ${count} fois`;
  if (until) {
    const d = new Date(until);
    return `${text}, jusqu'au ${d.getUTCDate()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  return text;
}

/** Retrouve le choix d'interface correspondant à une règle existante. */
export function recurrenceToPreset(rule: string | null | undefined): RecurrencePreset {
  if (!rule) return { type: 'aucune' };
  try {
    const parsed = rrulestr(rule.startsWith('RRULE:') ? rule : `RRULE:${rule}`) as RRule;
    const { freq, interval = 1, byweekday } = parsed.options;
    const days = (byweekday ?? []) as number[];

    if (freq === RRule.DAILY && interval === 1) return { type: 'quotidienne' };
    if (freq === RRule.WEEKLY && interval === 1 && days.length === 0) {
      return { type: 'hebdomadaire' };
    }
    if (freq === RRule.WEEKLY && interval === 2 && days.length === 0) {
      return { type: 'toutes_deux_semaines' };
    }
    if (freq === RRule.WEEKLY && interval === 1 && days.length > 0) {
      return { type: 'jours', weekdays: days };
    }
    if (freq === RRule.MONTHLY && interval === 1) return { type: 'mensuelle' };
  } catch {
    /* règle non reconnue */
  }
  return { type: 'personnalisee', rule };
}
