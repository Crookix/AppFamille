/**
 * Quand faut-il synchroniser, et quoi ?
 *
 * Trois déclencheurs automatiques coexistent — le cron, l'ouverture de l'écran
 * Calendrier, et les notifications push de Google. Chacun pourrait décider
 * seul, et c'est précisément ce qu'il faut éviter : trois politiques écrites à
 * trois endroits finiraient par se contredire, et l'on passerait la journée à
 * se demander pourquoi tel calendrier se synchronise dix fois par minute et
 * tel autre jamais.
 *
 * Toute la décision tient donc ici, en fonctions pures — sans base, sans
 * réseau, sans horloge implicite : `now` est toujours passé en argument, ce
 * qui rend chaque règle vérifiable par un test plutôt que par l'observation.
 */

/* -------------------------------------------------------------------------- */
/* Réglages                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Nombre maximum de calendriers traités par un passage du cron.
 *
 * Une fonction Vercel a une durée bornée : mieux vaut synchroniser vingt
 * calendriers jusqu'au bout et laisser les suivants au passage d'après, que
 * d'en commencer cent et se faire couper au milieu.
 */
export const CRON_CALENDAR_BUDGET = 20;

/**
 * Temps au-delà duquel le cron n'entame plus de nouveau calendrier.
 *
 * `maxDuration` vaut 60 secondes : on garde de la marge pour finir proprement
 * le calendrier en cours et écrire le compte rendu.
 */
export const CRON_TIME_BUDGET_MS = 45_000;

/**
 * Délai minimum entre deux synchronisations d'un même calendrier.
 *
 * Sans lui, un calendrier que les notifications push viennent de rafraîchir
 * serait resynchronisé quelques secondes plus tard par le cron, pour rien.
 */
export const MIN_SYNC_INTERVAL_MINUTES = 10;

/**
 * Patience après une erreur.
 *
 * Une autorisation révoquée échoue à chaque tentative. Sans recul, un seul
 * compte cassé consommerait tout le budget du cron, à chaque passage, et
 * masquerait les foyers qui, eux, ont quelque chose à synchroniser.
 */
export const ERROR_BACKOFF_MINUTES = 60;

/**
 * Fraîcheur exigée à l'ouverture de l'écran Calendrier.
 *
 * Plus court que l'intervalle du cron : ouvrir le calendrier est le moment où
 * l'on veut voir les choses à jour, c'est donc le moment de payer l'aller-retour.
 */
export const OPEN_SCREEN_STALE_MINUTES = 5;

/**
 * Durée de vie demandée pour un canal de notification, en secondes.
 *
 * Google peut la réduire — c'est l'expiration qu'il renvoie qui fait foi et
 * qui est enregistrée, jamais celle qu'on a demandée.
 */
export const WATCH_TTL_SECONDS = 604_800; // 7 jours

/** Marge de renouvellement d'un canal, en heures. */
export const WATCH_RENEWAL_MARGIN_HOURS = 24;

/* -------------------------------------------------------------------------- */
/* Outils                                                                     */
/* -------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;

/**
 * Date lisible, ou `null`.
 *
 * Une date absente et une date illisible se traitent pareil : on ne sait pas
 * quand ça s'est produit, donc on considère que ça ne s'est jamais produit.
 * C'est le choix prudent — il fait travailler, il ne fait pas sauter de tour.
 */
function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Âge en minutes, ou `Infinity` si la date manque. */
export function minutesSince(value: string | null | undefined, now: Date): number {
  const time = timeOf(value);
  if (time === null) return Number.POSITIVE_INFINITY;
  return (now.getTime() - time) / MINUTE_MS;
}

/** La dernière synchronisation remonte-t-elle à plus de `minutes` ? */
export function isStale(
  lastSyncAt: string | null | undefined,
  now: Date,
  minutes: number,
): boolean {
  return minutesSince(lastSyncAt, now) >= minutes;
}

/* -------------------------------------------------------------------------- */
/* Choix des calendriers                                                      */
/* -------------------------------------------------------------------------- */

export type SchedulableCalendar = {
  id: string;
  last_sync_at: string | null;
  last_error: string | null;
};

export type SelectionOptions = {
  now: Date;
  budget?: number;
  minIntervalMinutes?: number;
  errorBackoffMinutes?: number;
};

/**
 * Les calendriers qu'un passage du cron doit traiter, dans l'ordre.
 *
 * Le tri est le plus ancien d'abord, un calendrier jamais synchronisé passant
 * avant tous les autres. C'est ce qui garantit la rotation : au-delà du
 * budget, les laissés-pour-compte d'un passage sont les premiers servis au
 * suivant, et aucun calendrier ne peut rester indéfiniment en queue.
 */
export function selectCalendarsForCron<T extends SchedulableCalendar>(
  calendars: T[],
  options: SelectionOptions,
): T[] {
  const {
    now,
    budget = CRON_CALENDAR_BUDGET,
    minIntervalMinutes = MIN_SYNC_INTERVAL_MINUTES,
    errorBackoffMinutes = ERROR_BACKOFF_MINUTES,
  } = options;

  return calendars
    .filter((calendar) => {
      const age = minutesSince(calendar.last_sync_at, now);
      // Le dernier passage a échoué : on laisse retomber avant de réessayer.
      if (calendar.last_error) return age >= errorBackoffMinutes;
      return age >= minIntervalMinutes;
    })
    .sort(
      (a, b) =>
        minutesSince(b.last_sync_at, now) - minutesSince(a.last_sync_at, now),
    )
    .slice(0, Math.max(0, budget));
}

/* -------------------------------------------------------------------------- */
/* Canaux de notification                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Faut-il réinscrire ce canal auprès de Google ?
 *
 * Une expiration inconnue vaut « oui » : un canal dont on ignore l'échéance
 * est un canal qu'on risque de laisser mourir sans s'en apercevoir, et une
 * réinscription inutile coûte une requête, là où un canal mort coûte des
 * notifications perdues en silence.
 */
export function needsChannelRenewal(
  expiresAt: string | null | undefined,
  now: Date,
  marginHours: number = WATCH_RENEWAL_MARGIN_HOURS,
): boolean {
  const time = timeOf(expiresAt);
  if (time === null) return true;
  return time - now.getTime() <= marginHours * 60 * MINUTE_MS;
}
