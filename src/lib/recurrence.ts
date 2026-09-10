import { RRule } from 'rrule';
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
  /**
   * Recul appliqué au début de la fenêtre, en millisecondes. Un événement qui
   * commence avant la fenêtre peut la chevaucher : on passe ici sa durée pour
   * ne pas le manquer. Aucun débord n'est ajouté à la fin — une occurrence qui
   * commence après la fenêtre ne peut pas la chevaucher.
   */
  padBackMs = 0,
): Date[] {
  const wallStart = toWallClock(seriesStart, timezone);

  let rrule: RRule;
  try {
    const options = RRule.parseString(rule.replace(/^RRULE:/i, ''));

    // `UNTIL` est un instant réel, alors que le déroulé se fait en heures
    // murales. Sans cette conversion, une série se terminerait avec le
    // décalage du fuseau d'écart — soit une occurrence de trop ou de moins.
    const until = options.until ? toWallClock(options.until, timezone) : undefined;

    rrule = new RRule({ ...options, dtstart: wallStart, ...(until ? { until } : {}) });
  } catch {
    // Une règle illisible ne doit pas faire disparaître l'événement :
    // on retombe sur l'occurrence unique de départ.
    return [seriesStart];
  }

  const from = toWallClock(new Date(rangeStart.getTime() - padBackMs), timezone);
  const to = toWallClock(rangeEnd, timezone);

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
      durationMs,
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

const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * Construit une RRULE à partir d'un choix d'interface.
 *
 * La chaîne est composée directement plutôt que via `new RRule(...).toString()` :
 * cette dernière déduit d'office un `BYDAY` de la date de départ, si bien
 * qu'une règle « toutes les semaines » se retrouverait figée sur le jour de la
 * semaine en cours au moment de la création. Le jour doit venir de la date de
 * l'événement, pas de l'instant où on l'a saisi.
 */
export function buildRecurrenceRule(
  preset: RecurrencePreset,
  until?: Date | null,
): string | null {
  if (preset.type === 'aucune') return null;
  if (preset.type === 'personnalisee') return preset.rule || null;

  const parts: string[] = (() => {
    switch (preset.type) {
      case 'quotidienne':
        return ['FREQ=DAILY'];
      case 'hebdomadaire':
        return ['FREQ=WEEKLY'];
      case 'toutes_deux_semaines':
        return ['FREQ=WEEKLY', 'INTERVAL=2'];
      case 'mensuelle':
        return ['FREQ=MONTHLY'];
      case 'jours': {
        const days = [...new Set(preset.weekdays)]
          .filter((d) => d >= 0 && d < 7)
          .sort((a, b) => a - b)
          .map((d) => BYDAY_CODES[d]);
        return days.length > 0 ? ['FREQ=WEEKLY', `BYDAY=${days.join(',')}`] : ['FREQ=WEEKLY'];
      }
    }
  })();

  if (until) {
    parts.push(`UNTIL=${until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  }

  return parts.join(';');
}

/**
 * Lit une RRULE sans lui inventer de date de départ.
 *
 * `rrulestr` complète les champs manquants à partir d'un DTSTART implicite fixé
 * à l'instant courant : « FREQ=WEEKLY » y devient « chaque jeudi » un jeudi.
 * `RRule.parseString` se contente de ce qui est écrit.
 */
function parseRuleOptions(rule: string) {
  return RRule.parseString(rule.replace(/^RRULE:/i, ''));
}

/** Normalise `byweekday` en indices 0 (lundi) à 6 (dimanche). */
function weekdayIndexes(byweekday: unknown): number[] {
  if (byweekday === null || byweekday === undefined) return [];
  const list = Array.isArray(byweekday) ? byweekday : [byweekday];
  return list
    .map((day) => {
      if (typeof day === 'number') return day;
      if (day && typeof day === 'object' && 'weekday' in day) {
        return (day as { weekday: number }).weekday;
      }
      return null;
    })
    .filter((d): d is number => d !== null);
}

const FR_WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Décrit une règle en français, pour l'afficher dans la fiche d'un événement. */
export function describeRecurrence(rule: string | null | undefined): string | null {
  if (!rule) return null;

  let options: ReturnType<typeof parseRuleOptions>;
  try {
    options = parseRuleOptions(rule);
  } catch {
    return 'Répétition personnalisée';
  }

  const { freq, interval = 1, byweekday, until, count } = options;

  let text: string;
  if (freq === RRule.DAILY) {
    text = interval === 1 ? 'Tous les jours' : `Tous les ${interval} jours`;
  } else if (freq === RRule.WEEKLY) {
    const days = weekdayIndexes(byweekday);
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
    const { freq, interval = 1, byweekday } = parseRuleOptions(rule);
    const days = weekdayIndexes(byweekday);

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
