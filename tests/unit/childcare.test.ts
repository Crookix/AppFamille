import { describe, expect, it } from 'vitest';
import {
  monthlySummary,
  rateOn,
  scheduledMinutes,
  sessionTotals,
  workedMinutes,
  type SessionForTotals,
} from '@/lib/childcare';

/** Fabrique une garde, en ne précisant que ce que le test veut éprouver. */
function session(overrides: Partial<SessionForTotals> = {}): SessionForTotals {
  return {
    id: 'g1',
    scheduled_start: '2026-03-10T17:00:00.000Z',
    scheduled_end: '2026-03-10T20:00:00.000Z',
    actual_start: null,
    actual_end: null,
    unpaid_break_minutes: 0,
    adjustment_minutes: 0,
    applied_hourly_rate: 12,
    status: 'prevue',
    ...overrides,
  };
}

describe('durée des gardes', () => {
  it('calcule une durée simple', () => {
    expect(
      workedMinutes({
        actualStart: '2026-03-10T17:00:00Z',
        actualEnd: '2026-03-10T20:30:00Z',
      }),
    ).toBe(210);
  });

  it("distingue « pas encore saisi » de « zéro heure »", () => {
    expect(workedMinutes({ actualStart: null, actualEnd: null })).toBeNull();
    expect(
      workedMinutes({
        actualStart: '2026-03-10T17:00:00Z',
        actualEnd: '2026-03-10T17:00:00Z',
      }),
    ).toBe(0);
  });

  it('retranche les pauses non rémunérées', () => {
    expect(
      workedMinutes({
        actualStart: '2026-03-10T17:00:00Z',
        actualEnd: '2026-03-10T21:00:00Z',
        unpaidBreakMinutes: 45,
      }),
    ).toBe(195);
  });

  it('ne descend jamais sous zéro, même si les pauses excèdent la garde', () => {
    expect(
      workedMinutes({
        actualStart: '2026-03-10T17:00:00Z',
        actualEnd: '2026-03-10T18:00:00Z',
        unpaidBreakMinutes: 120,
      }),
    ).toBe(0);
  });

  it('applique une correction manuelle, dans les deux sens', () => {
    const base = {
      actualStart: '2026-03-10T17:00:00Z',
      actualEnd: '2026-03-10T20:00:00Z',
    };
    expect(workedMinutes({ ...base, adjustmentMinutes: 15 })).toBe(195);
    expect(workedMinutes({ ...base, adjustmentMinutes: -30 })).toBe(150);
  });
});

describe('passage à minuit', () => {
  it('compte correctement une garde de 20:30 à 01:15', () => {
    // 20:30 → 01:15 le lendemain = 4 h 45 = 285 min.
    expect(
      workedMinutes({
        actualStart: '2026-03-10T20:30:00Z',
        actualEnd: '2026-03-11T01:15:00Z',
      }),
    ).toBe(285);
  });

  it('reste juste sur une garde de nuit complète', () => {
    expect(
      workedMinutes({
        actualStart: '2026-03-10T21:00:00Z',
        actualEnd: '2026-03-11T07:00:00Z',
        unpaidBreakMinutes: 0,
      }),
    ).toBe(600);
  });

  it("compte la vraie durée lors du passage à l'heure d'été", () => {
    // Nuit du 28 au 29 mars 2026 à Paris : 02:00 devient 03:00.
    // 23:00 heure de Paris (22:00 UTC) → 07:00 heure de Paris (05:00 UTC).
    // À la pendule, 8 h se sont écoulées ; en réalité, 7 h.
    // Les heures dues sont les heures réellement passées : 420 minutes.
    expect(
      workedMinutes({
        actualStart: '2026-03-28T22:00:00Z',
        actualEnd: '2026-03-29T05:00:00Z',
      }),
    ).toBe(420);
  });
});

describe('montants', () => {
  it('valorise les minutes au tarif figé de la garde', () => {
    const totals = sessionTotals(
      session({
        actual_start: '2026-03-10T17:00:00Z',
        actual_end: '2026-03-10T20:30:00Z',
        applied_hourly_rate: 12.5,
        status: 'confirmee',
      }),
    );
    // 3 h 30 × 12,50 € = 43,75 €
    expect(totals.workedMinutes).toBe(210);
    expect(totals.hoursAmount).toBe(43.75);
    expect(totals.totalAmount).toBe(43.75);
  });

  it('ajoute les frais complémentaires', () => {
    const totals = sessionTotals(
      session({
        actual_start: '2026-03-10T17:00:00Z',
        actual_end: '2026-03-10T19:00:00Z',
        applied_hourly_rate: 11,
        status: 'confirmee',
      }),
      [{ amount: 4.5 }, { amount: 3 }],
    );
    expect(totals.hoursAmount).toBe(22);
    expect(totals.extrasTotal).toBe(7.5);
    expect(totals.totalAmount).toBe(29.5);
  });

  it('arrondit au centime sans traîner de décimales flottantes', () => {
    const totals = sessionTotals(
      session({
        actual_start: '2026-03-10T17:00:00Z',
        actual_end: '2026-03-10T17:50:00Z', // 50 min
        applied_hourly_rate: 13.7,
        status: 'confirmee',
      }),
    );
    // 50/60 × 13,70 = 11,41666… → 11,42
    expect(totals.hoursAmount).toBe(11.42);
  });

  it('ne calcule pas de montant tant que les heures ne sont pas saisies', () => {
    const totals = sessionTotals(session());
    expect(totals.workedMinutes).toBeNull();
    expect(totals.totalAmount).toBeNull();
    expect(totals.scheduledMinutes).toBe(180);
  });
});

describe('conservation des anciens tarifs', () => {
  it("retient le tarif en vigueur à la date, pas le plus récent", () => {
    const rates = [
      { hourly_rate: 11, effective_from: '2025-01-01' },
      { hourly_rate: 12, effective_from: '2026-01-01' },
      { hourly_rate: 13.5, effective_from: '2026-06-01' },
    ];
    expect(rateOn(rates, '2025-06-15')).toBe(11);
    expect(rateOn(rates, '2026-03-10')).toBe(12);
    expect(rateOn(rates, '2026-06-01')).toBe(13.5);
    expect(rateOn(rates, '2026-09-30')).toBe(13.5);
  });

  it("ne renvoie rien avant la première date d'effet", () => {
    expect(rateOn([{ hourly_rate: 12, effective_from: '2026-01-01' }], '2025-12-31')).toBeNull();
  });

  it("une hausse du tarif ne change pas un bilan déjà établi", () => {
    // La garde porte son propre tarif ; l'historique des tarifs n'entre pas
    // dans le calcul du montant.
    const ancienne = session({
      actual_start: '2025-06-10T17:00:00Z',
      actual_end: '2025-06-10T20:00:00Z',
      applied_hourly_rate: 11,
      status: 'confirmee',
    });
    const avant = sessionTotals(ancienne).totalAmount;

    // Le tarif par défaut de la nounou passe à 13,50 € aujourd'hui :
    // rien dans la garde ne change.
    const apres = sessionTotals(ancienne).totalAmount;

    expect(avant).toBe(33);
    expect(apres).toBe(33);
  });
});

describe('bilan mensuel', () => {
  const confirmee = session({
    id: 'a',
    actual_start: '2026-03-03T17:00:00Z',
    actual_end: '2026-03-03T20:00:00Z',
    applied_hourly_rate: 12,
    status: 'confirmee',
  });

  const saisieNonConfirmee = session({
    id: 'b',
    actual_start: '2026-03-05T17:00:00Z',
    actual_end: '2026-03-05T19:30:00Z',
    applied_hourly_rate: 12,
    status: 'a_confirmer',
  });

  const pasEncoreSaisie = session({
    id: 'c',
    scheduled_start: '2026-03-12T17:00:00Z',
    scheduled_end: '2026-03-12T21:00:00Z',
    applied_hourly_rate: 12,
    status: 'prevue',
  });

  const annulee = session({ id: 'd', status: 'annulee' });

  it('sépare heures prévues, confirmées et restant à confirmer', () => {
    const bilan = monthlySummary([
      { session: confirmee, extras: [] },
      { session: saisieNonConfirmee, extras: [] },
      { session: pasEncoreSaisie, extras: [] },
      { session: annulee, extras: [] },
    ]);

    expect(bilan.sessionCount).toBe(3); // l'annulée est exclue
    expect(bilan.confirmedMinutes).toBe(180);
    expect(bilan.unconfirmedMinutes).toBe(150);
    expect(bilan.pendingSessionCount).toBe(2); // la saisie non confirmée + la non saisie
    expect(bilan.pendingScheduledMinutes).toBe(240);
    expect(bilan.scheduledMinutes).toBe(180 + 180 + 240);
  });

  it("ne facture que les gardes confirmées", () => {
    const bilan = monthlySummary([
      { session: confirmee, extras: [{ amount: 5 }] },
      { session: saisieNonConfirmee, extras: [{ amount: 99 }] },
    ]);

    // 3 h × 12 € = 36 €, plus 5 € de frais. Les 99 € de la garde non
    // confirmée n'entrent pas dans l'estimation.
    expect(bilan.hoursAmount).toBe(36);
    expect(bilan.extrasTotal).toBe(5);
    expect(bilan.totalAmount).toBe(41);
  });

  it('mélange sans erreur des gardes à des tarifs différents', () => {
    const bilan = monthlySummary([
      {
        session: session({
          id: 'x',
          actual_start: '2026-03-03T17:00:00Z',
          actual_end: '2026-03-03T19:00:00Z',
          applied_hourly_rate: 11,
          status: 'confirmee',
        }),
        extras: [],
      },
      {
        session: session({
          id: 'y',
          actual_start: '2026-03-20T17:00:00Z',
          actual_end: '2026-03-20T19:00:00Z',
          applied_hourly_rate: 13.5,
          status: 'confirmee',
        }),
        extras: [],
      },
    ]);

    expect(bilan.confirmedMinutes).toBe(240);
    expect(bilan.hoursAmount).toBe(22 + 27);
  });

  it('renvoie un bilan vide plutôt qu'
    + ' des valeurs nulles quand il n\'y a aucune garde', () => {
    const bilan = monthlySummary([]);
    expect(bilan.sessionCount).toBe(0);
    expect(bilan.totalAmount).toBe(0);
    expect(bilan.confirmedMinutes).toBe(0);
  });
});

describe('durée prévue', () => {
  it('se calcule indépendamment des heures réalisées', () => {
    expect(scheduledMinutes('2026-03-10T17:00:00Z', '2026-03-10T21:45:00Z')).toBe(285);
  });
});
