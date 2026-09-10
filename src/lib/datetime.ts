import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

export const DEFAULT_TZ = 'Europe/Paris';

/**
 * Instant → « heure murale » figée en UTC.
 *
 * Le résultat n'est PAS un instant réel : c'est l'heure lue à la pendule dans
 * `tz`, encodée dans le fuseau UTC pour pouvoir être manipulée sans qu'aucun
 * changement d'heure ne s'y applique. C'est l'espace dans lequel on déroule
 * les récurrences, afin qu'un rendez-vous de 9 h reste à 9 h de part et
 * d'autre du passage à l'heure d'hiver.
 */
export function toWallClock(instant: Date | string, tz: string = DEFAULT_TZ): Date {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Date(`${formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm:ss")}Z`);
}

/** Opération inverse : heure murale → instant réel dans `tz`. */
export function fromWallClock(wall: Date, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(wall.toISOString().slice(0, 19), tz);
}

/** Date du jour (aaaa-mm-jj) telle qu'elle est lue dans `tz`. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

/** Jour civil d'un instant, dans `tz`. */
export function dayKey(instant: Date | string, tz: string = DEFAULT_TZ): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

/** Instant correspondant à minuit local d'une date donnée. */
export function startOfDayIn(day: string, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(`${day}T00:00:00`, tz);
}

/** Instant correspondant à minuit local du lendemain (borne exclusive). */
export function endOfDayIn(day: string, tz: string = DEFAULT_TZ): Date {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, tz);
}

/** Ajoute des jours à une date civile (aaaa-mm-jj), sans passer par un fuseau. */
export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant `day`. */
export function startOfWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  // getUTCDay : 0 = dimanche. On ramène à une semaine commençant le lundi.
  const shift = (date.getUTCDay() + 6) % 7;
  return addDays(day, -shift);
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string): string {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Formatage français                                                         */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const WEEKDAYS = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
];

export const WEEKDAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** « mardi 4 mars » (l'année n'apparaît que si elle diffère de l'actuelle). */
export function formatDayLong(day: string, opts?: { withYear?: boolean }): string {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = WEEKDAYS[date.getUTCDay()];
  const d = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const showYear = opts?.withYear ?? year !== new Date().getUTCFullYear();
  return `${weekday} ${d === 1 ? '1er' : d} ${month}${showYear ? ` ${year}` : ''}`;
}

/** « 4 mars » */
export function formatDayShort(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const d = date.getUTCDate();
  return `${d === 1 ? '1er' : d} ${MONTHS[date.getUTCMonth()]}`;
}

export function formatMonthLong(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** « 09:30 » dans le fuseau demandé. */
export function formatTime(instant: Date | string, tz: string = DEFAULT_TZ): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return formatInTimeZone(date, tz, 'HH:mm');
}

/** « Aujourd'hui », « Demain », « Hier », sinon la date longue. */
export function formatRelativeDay(day: string, tz: string = DEFAULT_TZ, now = new Date()): string {
  const today = todayIn(tz, now);
  if (day === today) return "Aujourd'hui";
  if (day === addDays(today, 1)) return 'Demain';
  if (day === addDays(today, -1)) return 'Hier';
  if (day === addDays(today, 2)) return 'Après-demain';
  return formatDayLong(day);
}

/** Abréviation du fuseau, affichée seulement quand elle est utile. */
export function timezoneLabel(instant: Date | string, tz: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  try {
    return formatInTimeZone(date, tz, 'zzz');
  } catch {
    return tz;
  }
}

/** Convertit un instant en champs `datetime-local` du fuseau demandé. */
export function toLocalInputValue(instant: Date | string, tz: string = DEFAULT_TZ): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm");
}

/** Opération inverse : valeur d'un `datetime-local` → instant. */
export function fromLocalInputValue(value: string, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(value.length === 16 ? `${value}:00` : value, tz);
}

export { toZonedTime };
