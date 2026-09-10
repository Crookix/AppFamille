import { createHash } from 'node:crypto';
import type { EventCategory, EventRow, GoogleShareMode } from '@/lib/database.types';
import { dayKey } from '@/lib/datetime';

/**
 * Correspondance entre un événement Tribu et un événement Google Calendar.
 *
 * Ces fonctions sont pures et sans accès réseau : ce sont elles que les tests
 * vérifient, car c'est là que se logent les doublons, les boucles et les
 * décalages d'horaire.
 *
 * Le modèle Tribu a été calqué dès le départ sur celui de Google
 * (`recurringEventId` + `originalStartTime` ↔ `recurring_parent_id` +
 * `original_starts_at`), si bien qu'il s'agit d'une correspondance et non
 * d'une traduction.
 */

/** Clé privée posée sur les événements que Tribu crée dans Google. */
export const TRIBU_PROPERTY = 'tribuEventId';

export type GoogleDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleEvent = {
  id?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDateTime;
  iCalUID?: string;
  etag?: string;
  updated?: string;
  sequence?: number;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
};

/* -------------------------------------------------------------------------- */
/* Google → Tribu                                                             */
/* -------------------------------------------------------------------------- */

export type ImportedEvent = {
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  recurrenceRule: string | null;
  /** Identifiant Google de la série, pour une occurrence modifiée. */
  googleRecurringEventId: string | null;
  originalStartsAt: string | null;
  isCancelled: boolean;
  isBusyOnly: boolean;
  category: EventCategory;
};

/**
 * Convertit un événement Google en champs Tribu.
 *
 * `shareMode` décide de ce que le foyer voit : en mode « disponibilité », le
 * titre et la description sont écartés — pas masqués à l'affichage, mais bien
 * absents de la base, pour qu'un agenda professionnel ne se retrouve pas
 * recopié dans l'application familiale.
 */
export function googleToLocal(
  event: GoogleEvent,
  options: { shareMode: GoogleShareMode; fallbackTimezone: string },
): ImportedEvent | null {
  const { shareMode, fallbackTimezone } = options;

  const start = event.start;
  const end = event.end;

  // Une occurrence annulée n'a souvent ni début ni fin : on la rattache par
  // son originalStartTime, qui suffit à identifier ce qu'elle supprime.
  const isCancelled = event.status === 'cancelled';
  const original = event.originalStartTime;

  if (!start?.date && !start?.dateTime) {
    if (!isCancelled || !original) return null;
  }

  const allDay = Boolean(start?.date ?? (isCancelled ? original?.date : undefined));
  const timezone = start?.timeZone ?? end?.timeZone ?? fallbackTimezone;

  const startsAt = allDay
    ? isoFromDate(start?.date ?? original?.date ?? '', timezone)
    : (start?.dateTime ?? original?.dateTime ?? '');

  const endsAt = allDay
    ? isoFromDate(end?.date ?? start?.date ?? original?.date ?? '', timezone)
    : (end?.dateTime ?? startsAt);

  if (!startsAt) return null;

  const busyOnly = shareMode === 'disponibilite';

  return {
    title: busyOnly ? 'Occupé' : (event.summary?.slice(0, 200) || 'Sans titre'),
    description: busyOnly ? null : (event.description?.slice(0, 4000) ?? null),
    location: busyOnly ? null : (event.location?.slice(0, 160) ?? null),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    allDay,
    timezone,
    // Google renvoie les lignes RRULE / EXDATE ; on ne conserve que la RRULE,
    // les exceptions arrivant sous forme d'occurrences distinctes.
    recurrenceRule:
      event.recurrence
        ?.find((line) => line.toUpperCase().startsWith('RRULE:'))
        ?.replace(/^RRULE:/i, '') ?? null,
    googleRecurringEventId: event.recurringEventId ?? null,
    originalStartsAt: original
      ? new Date(
          original.dateTime ?? isoFromDate(original.date ?? '', timezone),
        ).toISOString()
      : null,
    isCancelled,
    isBusyOnly: busyOnly,
    // Google ne porte pas la notion de catégorie familiale : tout ce qui est
    // importé arrive en « perso », modifiable ensuite dans Tribu.
    category: 'perso',
  };
}

/** « 2026-03-04 » → instant correspondant à minuit dans le fuseau donné. */
function isoFromDate(date: string, timeZone: string): string {
  if (!date) return '';
  // On délègue le décalage au moteur d'internationalisation plutôt que de le
  // calculer, ce qui évite toute erreur autour des changements d'heure.
  const noon = new Date(`${date}T12:00:00Z`);
  const offsetMinutes = timezoneOffsetMinutes(noon, timeZone);
  return new Date(`${date}T00:00:00Z`).toISOString().replace(
    'Z',
    formatOffset(offsetMinutes),
  );
}

function timezoneOffsetMinutes(instant: Date, timeZone: string): number {
  try {
    const local = new Date(
      instant.toLocaleString('en-US', { timeZone }),
    );
    const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Tribu → Google                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Construit le corps d'un événement Google à partir d'un événement Tribu.
 *
 * Les pièces jointes ne sont JAMAIS transmises : elles restent dans le
 * stockage privé de Tribu, accessibles aux seules personnes autorisées dans
 * l'application, même quand l'événement est synchronisé.
 */
export function localToGoogle(event: EventRow): GoogleEvent {
  const body: GoogleEvent = {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? event.address ?? undefined,
    extendedProperties: {
      private: { [TRIBU_PROPERTY]: event.id },
    },
  };

  if (event.all_day) {
    // Google attend des dates civiles, avec une fin EXCLUSIVE.
    body.start = { date: dayKey(event.starts_at, event.timezone) };
    body.end = { date: dayKey(event.ends_at, event.timezone) };
  } else {
    body.start = { dateTime: event.starts_at, timeZone: event.timezone };
    body.end = { dateTime: event.ends_at, timeZone: event.timezone };
  }

  if (event.recurrence_rule) {
    body.recurrence = [`RRULE:${event.recurrence_rule.replace(/^RRULE:/i, '')}`];
  }

  return body;
}

/* -------------------------------------------------------------------------- */
/* Anti-boucle                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Empreinte des champs synchronisés d'un événement.
 *
 * Deux gardes empêchent les boucles :
 *  1. `events.revision`, incrémenté par la base uniquement quand un champ
 *     significatif change, comparé à `pushed_revision` ;
 *  2. cette empreinte, qui détecte le cas où une écriture a bougé la révision
 *     sans rien changer de ce que Google voit (une réécriture à l'identique
 *     lors d'un import, typiquement).
 */
export function localFingerprint(event: EventRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        event.title,
        event.description ?? '',
        event.location ?? '',
        event.address ?? '',
        event.starts_at,
        event.ends_at,
        event.all_day,
        event.timezone,
        event.recurrence_rule ?? '',
      ]),
    )
    .digest('hex')
    .slice(0, 32);
}

/** Empreinte du côté Google, pour la même comparaison. */
export function remoteFingerprint(event: GoogleEvent): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        event.summary ?? '',
        event.description ?? '',
        event.location ?? '',
        event.start?.dateTime ?? event.start?.date ?? '',
        event.end?.dateTime ?? event.end?.date ?? '',
        Boolean(event.start?.date),
        event.start?.timeZone ?? '',
        event.recurrence?.find((l) => l.toUpperCase().startsWith('RRULE:')) ?? '',
      ]),
    )
    .digest('hex')
    .slice(0, 32);
}

/** Cet événement Google a-t-il été créé par Tribu ? */
export function isTribuOrigin(event: GoogleEvent): string | null {
  return event.extendedProperties?.private?.[TRIBU_PROPERTY] ?? null;
}

/** Le droit accordé par Google autorise-t-il l'écriture ? */
export function canWrite(accessRole: string | null | undefined): boolean {
  return accessRole === 'owner' || accessRole === 'writer';
}
