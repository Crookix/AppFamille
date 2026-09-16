import { describe, expect, it } from 'vitest';
import {
  CRON_CALENDAR_BUDGET,
  describeCronSchedule,
  ERROR_BACKOFF_MINUTES,
  isStale,
  MIN_SYNC_INTERVAL_MINUTES,
  minutesSince,
  needsChannelRenewal,
  selectCalendarsForCron,
  type SchedulableCalendar,
} from '@/lib/google/schedule';

/**
 * Ces règles décident quand Google est interrogé. Les vérifier ici plutôt que
 * de les observer en production, c'est la différence entre « le calendrier ne
 * se met plus à jour depuis mardi » et « ce test échoue ».
 */

const NOW = new Date('2026-09-15T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function calendar(
  id: string,
  lastSyncAt: string | null,
  lastError: string | null = null,
): SchedulableCalendar {
  return { id, last_sync_at: lastSyncAt, last_error: lastError };
}

describe('minutesSince', () => {
  it("traite l'absence de date comme un âge infini", () => {
    expect(minutesSince(null, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(minutesSince(undefined, NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('traite une date illisible comme une date absente', () => {
    // Une valeur corrompue en base ne doit pas geler un calendrier : on ne
    // sait pas quand il a été synchronisé, donc on le resynchronise.
    expect(minutesSince('pas-une-date', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('compte les minutes écoulées', () => {
    expect(minutesSince(minutesAgo(30), NOW)).toBe(30);
  });
});

describe('isStale', () => {
  it('considère périmé ce qui atteint exactement le seuil', () => {
    expect(isStale(minutesAgo(5), NOW, 5)).toBe(true);
    expect(isStale(minutesAgo(4), NOW, 5)).toBe(false);
  });

  it("considère périmé ce qui n'a jamais été synchronisé", () => {
    expect(isStale(null, NOW, 10)).toBe(true);
  });
});

describe('selectCalendarsForCron', () => {
  it('écarte ce qui vient juste d’être synchronisé', () => {
    const selection = selectCalendarsForCron(
      [
        calendar('frais', minutesAgo(MIN_SYNC_INTERVAL_MINUTES - 1)),
        calendar('vieux', minutesAgo(MIN_SYNC_INTERVAL_MINUTES + 1)),
      ],
      { now: NOW },
    );

    expect(selection.map((c) => c.id)).toEqual(['vieux']);
  });

  it('sert le plus ancien en premier, et le jamais-synchronisé avant tous', () => {
    const selection = selectCalendarsForCron(
      [
        calendar('recent', minutesAgo(20)),
        calendar('ancien', minutesAgo(600)),
        calendar('jamais', null),
        calendar('moyen', minutesAgo(120)),
      ],
      { now: NOW },
    );

    expect(selection.map((c) => c.id)).toEqual(['jamais', 'ancien', 'moyen', 'recent']);
  });

  it('laisse retomber un calendrier en erreur avant de réessayer', () => {
    const selection = selectCalendarsForCron(
      [
        calendar('casse', minutesAgo(ERROR_BACKOFF_MINUTES - 1), 'accès révoqué'),
        calendar('sain', minutesAgo(30)),
      ],
      { now: NOW },
    );

    expect(selection.map((c) => c.id)).toEqual(['sain']);
  });

  it('réessaie un calendrier en erreur une fois le délai passé', () => {
    const selection = selectCalendarsForCron(
      [calendar('casse', minutesAgo(ERROR_BACKOFF_MINUTES + 1), 'accès révoqué')],
      { now: NOW },
    );

    expect(selection.map((c) => c.id)).toEqual(['casse']);
  });

  it('respecte le budget sans perdre personne : les suivants passent au tour d’après', () => {
    const tous = Array.from({ length: 5 }, (_, i) =>
      calendar(`c${i}`, minutesAgo(60 + i * 10)),
    );

    const premier = selectCalendarsForCron(tous, { now: NOW, budget: 2 });
    expect(premier.map((c) => c.id)).toEqual(['c4', 'c3']);

    // Le passage suivant : les deux servis portent une date fraîche, les
    // autres remontent d'eux-mêmes en tête.
    const apres = tous.map((c) =>
      premier.some((p) => p.id === c.id) ? calendar(c.id, minutesAgo(0)) : c,
    );
    expect(selectCalendarsForCron(apres, { now: NOW, budget: 2 }).map((c) => c.id)).toEqual([
      'c2',
      'c1',
    ]);
  });

  it('a un budget par défaut, pour ne jamais tout entamer d’un coup', () => {
    const tous = Array.from({ length: CRON_CALENDAR_BUDGET + 5 }, (_, i) =>
      calendar(`c${i}`, null),
    );
    expect(selectCalendarsForCron(tous, { now: NOW })).toHaveLength(CRON_CALENDAR_BUDGET);
  });

  it('ne modifie pas la liste qu’on lui donne', () => {
    const tous = [calendar('a', minutesAgo(20)), calendar('b', minutesAgo(600))];
    selectCalendarsForCron(tous, { now: NOW });
    expect(tous.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('describeCronSchedule', () => {
  // Cette fonction existe à cause d'une panne : l'écran annonçait « toutes les
  // quinze minutes » pendant que le forfait Hobby refusait le déploiement.
  it('traduit la planification réellement en place', () => {
    expect(describeCronSchedule('0 4 * * *')).toBe('une fois par jour, vers 4 h UTC');
    expect(describeCronSchedule('30 4 * * *')).toBe('une fois par jour, vers 4 h 30 UTC');
    expect(describeCronSchedule('*/15 * * * *')).toBe('toutes les 15 minutes');
    expect(describeCronSchedule('0 */4 * * *')).toBe('toutes les 4 heures');
    expect(describeCronSchedule('0 * * * *')).toBe('toutes les heures');
  });

  it("n'invente rien pour ce qu'elle ne sait pas dire", () => {
    // Annoncer « toutes les heures » à côté d'une expression qu'on n'a pas
    // comprise serait pire que de ne pas traduire.
    expect(describeCronSchedule('0 3 */2 * *')).toBe('selon « 0 3 */2 * * »');
    expect(describeCronSchedule('0 9 * * 1-5')).toBe('selon « 0 9 * * 1-5 »');
    expect(describeCronSchedule('pas une expression')).toBe('selon « pas une expression »');
  });

  it("dit clairement quand il n'y a pas de planification", () => {
    expect(describeCronSchedule(undefined)).toBe('non planifié');
    expect(describeCronSchedule(null)).toBe('non planifié');
    expect(describeCronSchedule('')).toBe('non planifié');
  });
});

describe('needsChannelRenewal', () => {
  it('renouvelle un canal dont l’échéance approche', () => {
    const dans12h = new Date(NOW.getTime() + 12 * 3600_000).toISOString();
    expect(needsChannelRenewal(dans12h, NOW)).toBe(true);
  });

  it('laisse tranquille un canal encore loin de son terme', () => {
    const dans5j = new Date(NOW.getTime() + 5 * 24 * 3600_000).toISOString();
    expect(needsChannelRenewal(dans5j, NOW)).toBe(false);
  });

  it('voit venir un canal deux fois, même à un seul passage par jour', () => {
    // Le cas qui a imposé la marge de 48 h : sur le forfait Hobby de Vercel,
    // le cron ne passe qu'une fois par jour. À 24 h de marge, un canal auquel
    // il reste 23 h n'était vu qu'au passage suivant — après son expiration.
    const expiration = new Date(NOW.getTime() + 47 * 3600_000).toISOString();

    // La veille, il reste 71 h : rien à faire, et c'est bien ainsi.
    const veille = new Date(NOW.getTime() - 24 * 3600_000);
    expect(needsChannelRenewal(expiration, veille)).toBe(false);

    // Aujourd'hui, 47 h : première occasion.
    expect(needsChannelRenewal(expiration, NOW)).toBe(true);

    // Demain, 23 h : seconde occasion, toujours avant le terme.
    const lendemain = new Date(NOW.getTime() + 24 * 3600_000);
    expect(needsChannelRenewal(expiration, lendemain)).toBe(true);
  });

  it('renouvelle un canal déjà expiré', () => {
    const hier = new Date(NOW.getTime() - 24 * 3600_000).toISOString();
    expect(needsChannelRenewal(hier, NOW)).toBe(true);
  });

  it("renouvelle quand l'échéance est inconnue", () => {
    // Un canal dont on ignore le terme est un canal qu'on laisserait mourir
    // sans s'en apercevoir : une réinscription inutile coûte une requête.
    expect(needsChannelRenewal(null, NOW)).toBe(true);
    expect(needsChannelRenewal('pas-une-date', NOW)).toBe(true);
  });
});
