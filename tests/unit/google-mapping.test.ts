import { describe, expect, it } from 'vitest';
import {
  canWrite,
  googleToLocal,
  isTribuOrigin,
  localFingerprint,
  localToGoogle,
  remoteFingerprint,
  TRIBU_PROPERTY,
  type GoogleEvent,
} from '@/lib/google/mapping';
import type { EventRow } from '@/lib/database.types';

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'ev-1',
    household_id: 'h1',
    title: 'Réunion parents-profs',
    description: 'Salle 12',
    category: 'ecole',
    kind: 'standard',
    starts_at: '2026-03-04T17:00:00.000Z',
    ends_at: '2026-03-04T18:00:00.000Z',
    all_day: false,
    timezone: 'Europe/Paris',
    location: 'École Jules-Ferry',
    address: null,
    responsible_member_id: null,
    dropoff_member_id: null,
    pickup_member_id: null,
    recurrence_rule: null,
    recurring_parent_id: null,
    original_starts_at: null,
    is_cancelled: false,
    origin: 'tribu',
    google_calendar_ref: null,
    is_busy_only: false,
    revision: 1,
    created_by: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Google → MyFamily', () => {
  const options = { shareMode: 'details' as const, fallbackTimezone: 'Europe/Paris' };

  it('convertit un événement horaire avec son fuseau', () => {
    const result = googleToLocal(
      {
        id: 'g1',
        summary: 'Dentiste',
        description: 'Apporter la carte vitale',
        location: 'Cabinet',
        start: { dateTime: '2026-03-04T17:00:00+01:00', timeZone: 'Europe/Paris' },
        end: { dateTime: '2026-03-04T18:00:00+01:00', timeZone: 'Europe/Paris' },
      },
      options,
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Dentiste');
    expect(result!.allDay).toBe(false);
    expect(result!.timezone).toBe('Europe/Paris');
    expect(result!.startsAt).toBe('2026-03-04T16:00:00.000Z');
    expect(result!.endsAt).toBe('2026-03-04T17:00:00.000Z');
  });

  it("convertit une journée entière en instants du bon fuseau", () => {
    const result = googleToLocal(
      {
        id: 'g2',
        summary: 'Vacances',
        start: { date: '2026-07-10' },
        end: { date: '2026-07-15' }, // fin exclusive chez Google
      },
      options,
    );

    expect(result!.allDay).toBe(true);
    // 10 juillet à minuit heure de Paris (UTC+2 en été) = 09/07 22:00 UTC.
    expect(result!.startsAt).toBe('2026-07-09T22:00:00.000Z');
    expect(result!.endsAt).toBe('2026-07-14T22:00:00.000Z');
  });

  it('extrait la RRULE en ignorant les autres lignes de récurrence', () => {
    const result = googleToLocal(
      {
        id: 'g3',
        summary: 'Piscine',
        start: { dateTime: '2026-03-04T08:00:00Z' },
        end: { dateTime: '2026-03-04T09:00:00Z' },
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE;TZID=Europe/Paris:20260318T090000'],
      },
      options,
    );

    expect(result!.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=WE');
  });

  it('rattache une occurrence modifiée à sa série', () => {
    const result = googleToLocal(
      {
        id: 'g3_20260311T080000Z',
        summary: 'Piscine (décalée)',
        start: { dateTime: '2026-03-11T10:00:00Z' },
        end: { dateTime: '2026-03-11T11:00:00Z' },
        recurringEventId: 'g3',
        originalStartTime: { dateTime: '2026-03-11T08:00:00Z' },
      },
      options,
    );

    expect(result!.googleRecurringEventId).toBe('g3');
    expect(result!.originalStartsAt).toBe('2026-03-11T08:00:00.000Z');
    expect(result!.recurrenceRule).toBeNull();
  });

  it('reconnaît une suppression, même sans horaires', () => {
    const result = googleToLocal(
      {
        id: 'g3_20260318T080000Z',
        status: 'cancelled',
        recurringEventId: 'g3',
        originalStartTime: { dateTime: '2026-03-18T08:00:00Z' },
      },
      options,
    );

    expect(result).not.toBeNull();
    expect(result!.isCancelled).toBe(true);
    expect(result!.originalStartsAt).toBe('2026-03-18T08:00:00.000Z');
  });

  it("écarte titre et description en mode « disponibilité »", () => {
    const result = googleToLocal(
      {
        id: 'g4',
        summary: 'Entretien confidentiel avec le DRH',
        description: 'Négociation salariale',
        location: 'Siège social',
        start: { dateTime: '2026-03-04T09:00:00Z' },
        end: { dateTime: '2026-03-04T10:00:00Z' },
      },
      { shareMode: 'disponibilite', fallbackTimezone: 'Europe/Paris' },
    );

    // Le contenu n'est pas seulement masqué à l'affichage : il n'entre pas
    // dans la base du foyer.
    expect(result!.title).toBe('Occupé');
    expect(result!.description).toBeNull();
    expect(result!.location).toBeNull();
    expect(result!.isBusyOnly).toBe(true);
  });

  it('ignore un événement sans horaire exploitable', () => {
    expect(googleToLocal({ id: 'g5', summary: 'Vide' }, options)).toBeNull();
  });

  it('retombe sur le fuseau du calendrier si Google n’en donne pas', () => {
    const result = googleToLocal(
      {
        id: 'g6',
        summary: 'Sans fuseau',
        start: { dateTime: '2026-03-04T09:00:00Z' },
        end: { dateTime: '2026-03-04T10:00:00Z' },
      },
      { shareMode: 'details', fallbackTimezone: 'America/Montreal' },
    );
    expect(result!.timezone).toBe('America/Montreal');
  });
});

describe('MyFamily → Google', () => {
  it('envoie dateTime et fuseau pour un événement horaire', () => {
    const body = localToGoogle(event());
    expect(body.start).toEqual({
      dateTime: '2026-03-04T17:00:00.000Z',
      timeZone: 'Europe/Paris',
    });
    expect(body.summary).toBe('Réunion parents-profs');
  });

  it('envoie des dates civiles pour une journée entière', () => {
    const body = localToGoogle(
      event({
        all_day: true,
        // Minuit à Paris le 10 juillet, jusqu'à minuit le 15.
        starts_at: '2026-07-09T22:00:00.000Z',
        ends_at: '2026-07-14T22:00:00.000Z',
      }),
    );

    expect(body.start).toEqual({ date: '2026-07-10' });
    expect(body.end).toEqual({ date: '2026-07-15' });
    expect(body.start?.dateTime).toBeUndefined();
  });

  it('préfixe la règle de récurrence comme Google l’attend', () => {
    const body = localToGoogle(event({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }));
    expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE']);
  });

  it('ne double pas le préfixe RRULE', () => {
    const body = localToGoogle(event({ recurrence_rule: 'RRULE:FREQ=DAILY' }));
    expect(body.recurrence).toEqual(['RRULE:FREQ=DAILY']);
  });

  it('marque les événements créés par MyFamily', () => {
    const body = localToGoogle(event({ id: 'ev-42' }));
    expect(body.extendedProperties?.private?.[TRIBU_PROPERTY]).toBe('ev-42');
    expect(isTribuOrigin(body)).toBe('ev-42');
  });

  it("ne transmet jamais de pièce jointe à Google", () => {
    const body = localToGoogle(event()) as Record<string, unknown>;
    // Les documents du foyer restent dans le stockage privé de MyFamily.
    expect(body.attachments).toBeUndefined();
  });
});

describe('aller-retour sans dérive', () => {
  it("réimporte un événement exporté à l'identique", () => {
    const local = event({
      starts_at: '2026-03-04T17:00:00.000Z',
      ends_at: '2026-03-04T18:00:00.000Z',
    });

    const exported = localToGoogle(local);
    const reimported = googleToLocal(
      { ...exported, id: 'g-round' },
      { shareMode: 'details', fallbackTimezone: 'Europe/Paris' },
    );

    expect(reimported!.startsAt).toBe(local.starts_at);
    expect(reimported!.endsAt).toBe(local.ends_at);
    expect(reimported!.title).toBe(local.title);
    expect(reimported!.allDay).toBe(false);
  });

  it("réimporte une journée entière sans décaler les dates", () => {
    const local = event({
      all_day: true,
      starts_at: '2026-07-09T22:00:00.000Z',
      ends_at: '2026-07-14T22:00:00.000Z',
    });

    const exported = localToGoogle(local);
    const reimported = googleToLocal(
      { ...exported, id: 'g-round-2' },
      { shareMode: 'details', fallbackTimezone: 'Europe/Paris' },
    );

    expect(reimported!.allDay).toBe(true);
    expect(reimported!.startsAt).toBe(local.starts_at);
    expect(reimported!.endsAt).toBe(local.ends_at);
  });
});

describe('empreintes anti-boucle', () => {
  it('reste stable quand rien de significatif ne change', () => {
    const a = event();
    const b = event({ updated_at: '2027-01-01T00:00:00.000Z', revision: 9 });
    // Ni la date de mise à jour ni la révision n'entrent dans l'empreinte :
    // seule compte la matière réellement synchronisée.
    expect(localFingerprint(a)).toBe(localFingerprint(b));
  });

  it('change dès qu’un champ synchronisé bouge', () => {
    expect(localFingerprint(event())).not.toBe(
      localFingerprint(event({ title: 'Autre titre' })),
    );
    expect(localFingerprint(event())).not.toBe(
      localFingerprint(event({ starts_at: '2026-03-04T18:00:00.000Z' })),
    );
  });

  it('distingue deux événements Google différents', () => {
    const a: GoogleEvent = {
      summary: 'A',
      start: { dateTime: '2026-03-04T17:00:00Z' },
      end: { dateTime: '2026-03-04T18:00:00Z' },
    };
    const b: GoogleEvent = { ...a, summary: 'B' };
    expect(remoteFingerprint(a)).not.toBe(remoteFingerprint(b));
  });
});

describe("droits d'écriture", () => {
  it("n'autorise l'écriture que pour owner et writer", () => {
    expect(canWrite('owner')).toBe(true);
    expect(canWrite('writer')).toBe(true);
    // Un calendrier partagé en lecture ne doit jamais recevoir d'écriture.
    expect(canWrite('reader')).toBe(false);
    expect(canWrite('freeBusyReader')).toBe(false);
    expect(canWrite('writerWithoutPrivateAccess')).toBe(false);
    expect(canWrite(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});
