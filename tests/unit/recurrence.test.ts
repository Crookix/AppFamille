import { describe, expect, it } from 'vitest';
import {
  buildRecurrenceRule,
  describeRecurrence,
  expandEvents,
  expandRule,
  occurrenceKey,
  recurrenceToPreset,
} from '@/lib/recurrence';
import { formatTime } from '@/lib/datetime';
import type { EventRow } from '@/lib/database.types';

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    household_id: 'h1',
    title: 'Piscine',
    description: null,
    category: 'activite',
    kind: 'standard',
    starts_at: '2026-03-04T08:00:00.000Z',
    ends_at: '2026-03-04T09:00:00.000Z',
    all_day: false,
    timezone: 'Europe/Paris',
    location: null,
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

describe('déroulé des règles', () => {
  it('produit une occurrence par semaine', () => {
    const starts = expandRule(
      'FREQ=WEEKLY;BYDAY=WE',
      new Date('2026-03-04T08:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-31T23:59:59Z'),
      'Europe/Paris',
    );
    // Mercredis de mars 2026 à partir du 4 : 4, 11, 18, 25.
    expect(starts.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-03-04',
      '2026-03-11',
      '2026-03-18',
      '2026-03-25',
    ]);
  });

  it("garde l'heure locale lors du passage à l'heure d'été", () => {
    // Le changement d'heure à Paris a lieu le dimanche 29 mars 2026.
    // Un rendez-vous hebdomadaire à 9 h doit rester à 9 h après ce dimanche,
    // alors que l'instant UTC correspondant change (08:00Z → 07:00Z).
    const starts = expandRule(
      'FREQ=WEEKLY;BYDAY=WE',
      new Date('2026-03-04T08:00:00Z'), // 09:00 à Paris, heure d'hiver
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-04-30T00:00:00Z'),
      'Europe/Paris',
    );

    for (const start of starts) {
      expect(formatTime(start, 'Europe/Paris')).toBe('09:00');
    }

    const avant = starts.find((d) => d.toISOString().startsWith('2026-03-25'));
    const apres = starts.find((d) => d.toISOString().startsWith('2026-04-01'));
    expect(avant?.toISOString()).toBe('2026-03-25T08:00:00.000Z');
    expect(apres?.toISOString()).toBe('2026-04-01T07:00:00.000Z');
  });

  it("garde l'heure locale lors du passage à l'heure d'hiver", () => {
    // Retour à l'heure d'hiver : dimanche 25 octobre 2026.
    const starts = expandRule(
      'FREQ=WEEKLY;BYDAY=TH',
      new Date('2026-10-15T15:00:00Z'), // 17:00 à Paris, heure d'été
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-15T00:00:00Z'),
      'Europe/Paris',
    );
    for (const start of starts) {
      expect(formatTime(start, 'Europe/Paris')).toBe('17:00');
    }
    expect(
      starts.find((d) => d.toISOString().startsWith('2026-10-29'))?.toISOString(),
    ).toBe('2026-10-29T16:00:00.000Z');
  });

  it('respecte une date de fin', () => {
    const starts = expandRule(
      'FREQ=DAILY;UNTIL=20260307T080000Z',
      new Date('2026-03-04T08:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-31T00:00:00Z'),
      'Europe/Paris',
    );
    expect(starts).toHaveLength(4); // 4, 5, 6, 7
  });

  it("ne fait pas disparaître l'événement si la règle est illisible", () => {
    const starts = expandRule(
      'CECI N EST PAS UNE RRULE',
      new Date('2026-03-04T08:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-31T00:00:00Z'),
      'Europe/Paris',
    );
    expect(starts).toHaveLength(1);
    expect(starts[0].toISOString()).toBe('2026-03-04T08:00:00.000Z');
  });

  it("borne une règle sans fin plutôt que de boucler", () => {
    const starts = expandRule(
      'FREQ=DAILY',
      new Date('2020-01-01T08:00:00Z'),
      new Date('2020-01-01T00:00:00Z'),
      new Date('2030-01-01T00:00:00Z'),
      'Europe/Paris',
    );
    expect(starts.length).toBeLessThanOrEqual(750);
  });
});

describe('séries et exceptions', () => {
  const serie = event({
    id: 'serie',
    recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE',
    starts_at: '2026-03-04T08:00:00.000Z',
    ends_at: '2026-03-04T09:00:00.000Z',
  });

  const fenetre = {
    from: new Date('2026-03-01T00:00:00Z'),
    to: new Date('2026-03-31T23:59:59Z'),
  };

  it('déroule la série sur la fenêtre', () => {
    const occurrences = expandEvents([serie], fenetre.from, fenetre.to);
    expect(occurrences).toHaveLength(4);
    expect(occurrences.every((o) => o.isRecurring)).toBe(true);
    expect(occurrences.every((o) => o.event.id === 'serie')).toBe(true);
  });

  it("remplace une seule occurrence par son exception", () => {
    const exception = event({
      id: 'ex1',
      recurring_parent_id: 'serie',
      original_starts_at: '2026-03-11T08:00:00.000Z',
      starts_at: '2026-03-11T10:00:00.000Z', // décalée de deux heures
      ends_at: '2026-03-11T11:00:00.000Z',
      title: 'Piscine (décalée)',
      recurrence_rule: null,
    });

    const occurrences = expandEvents([serie, exception], fenetre.from, fenetre.to);

    expect(occurrences).toHaveLength(4);
    const modifiee = occurrences.find((o) => o.isException);
    expect(modifiee?.event.title).toBe('Piscine (décalée)');
    expect(modifiee?.startsAt.toISOString()).toBe('2026-03-11T10:00:00.000Z');
    // La clé reste celle de l'occurrence d'origine : c'est ce qui permet de
    // la retrouver dans la série.
    expect(modifiee?.key).toBe(occurrenceKey('serie', new Date('2026-03-11T08:00:00Z')));
    // Les autres occurrences sont intactes.
    expect(occurrences.filter((o) => o.event.title === 'Piscine')).toHaveLength(3);
  });

  it('fait disparaître une occurrence annulée sans toucher aux autres', () => {
    const annulee = event({
      id: 'ex2',
      recurring_parent_id: 'serie',
      original_starts_at: '2026-03-18T08:00:00.000Z',
      starts_at: '2026-03-18T08:00:00.000Z',
      ends_at: '2026-03-18T09:00:00.000Z',
      is_cancelled: true,
      recurrence_rule: null,
    });

    const occurrences = expandEvents([serie, annulee], fenetre.from, fenetre.to);
    expect(occurrences).toHaveLength(3);
    expect(
      occurrences.some((o) => o.startsAt.toISOString().startsWith('2026-03-18')),
    ).toBe(false);
  });

  it('conserve la durée de la série sur chaque occurrence', () => {
    const longue = event({
      id: 'longue',
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=SA',
      starts_at: '2026-03-07T09:00:00.000Z',
      ends_at: '2026-03-07T17:30:00.000Z',
    });
    const occurrences = expandEvents([longue], fenetre.from, fenetre.to);
    for (const occurrence of occurrences) {
      expect(occurrence.endsAt.getTime() - occurrence.startsAt.getTime()).toBe(
        8.5 * 3600 * 1000,
      );
    }
  });

  it('inclut un événement non récurrent qui chevauche la fenêtre', () => {
    const chevauchant = event({
      id: 'voyage',
      starts_at: '2026-02-27T18:00:00.000Z',
      ends_at: '2026-03-02T10:00:00.000Z',
      recurrence_rule: null,
    });
    const occurrences = expandEvents([chevauchant], fenetre.from, fenetre.to);
    expect(occurrences).toHaveLength(1);
  });

  it("exclut un événement entièrement hors de la fenêtre", () => {
    const horsFenetre = event({
      id: 'vieux',
      starts_at: '2026-01-05T08:00:00.000Z',
      ends_at: '2026-01-05T09:00:00.000Z',
    });
    expect(expandEvents([horsFenetre], fenetre.from, fenetre.to)).toHaveLength(0);
  });

  it('rend les occurrences triées chronologiquement', () => {
    const autre = event({ id: 'autre', starts_at: '2026-03-12T06:00:00.000Z', ends_at: '2026-03-12T07:00:00.000Z' });
    const occurrences = expandEvents([serie, autre], fenetre.from, fenetre.to);
    const temps = occurrences.map((o) => o.startsAt.getTime());
    expect([...temps].sort((a, b) => a - b)).toEqual(temps);
  });
});

describe('construction et lecture des règles', () => {
  it("fait l'aller-retour entre choix d'interface et RRULE", () => {
    const cas = [
      { type: 'quotidienne' },
      { type: 'hebdomadaire' },
      { type: 'toutes_deux_semaines' },
      { type: 'mensuelle' },
      { type: 'jours', weekdays: [0, 2, 4] },
    ] as const;

    for (const preset of cas) {
      const rule = buildRecurrenceRule(preset);
      expect(rule).toBeTruthy();
      expect(recurrenceToPreset(rule)).toEqual(preset);
    }
  });

  it('ne produit aucune règle pour « aucune répétition »', () => {
    expect(buildRecurrenceRule({ type: 'aucune' })).toBeNull();
    expect(recurrenceToPreset(null)).toEqual({ type: 'aucune' });
  });

  it('décrit la règle en français', () => {
    expect(describeRecurrence('FREQ=DAILY')).toBe('Tous les jours');
    expect(describeRecurrence('FREQ=WEEKLY')).toBe('Toutes les semaines');
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2')).toBe('Toutes les 2 semaines');
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('Chaque lundi, mercredi');
    expect(describeRecurrence('FREQ=MONTHLY')).toBe('Tous les mois');
    expect(describeRecurrence(null)).toBeNull();
  });

  it("n'inclut pas de DTSTART dans la règle produite", () => {
    const rule = buildRecurrenceRule({ type: 'jours', weekdays: [1, 3] });
    expect(rule).not.toMatch(/DTSTART/i);
    expect(rule).not.toMatch(/^RRULE:/i);
  });
});
