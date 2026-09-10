/**
 * Calcul des heures de garde et des bilans mensuels.
 *
 * Ces règles existent en deux exemplaires : ici, pour l'affichage immédiat,
 * et dans la base sous forme de colonnes calculées (migration 0005). Les tests
 * unitaires vérifient que les deux donnent le même résultat sur les cas qui
 * comptent — passage à minuit, pauses, corrections.
 *
 * Le principe qui rend le passage à minuit non problématique : on ne manipule
 * jamais des heures nues, uniquement des instants complets. Une garde de 20 h 30
 * à 1 h 15 est une soustraction ordinaire.
 */

export type SessionTimes = {
  actualStart: Date | string | null;
  actualEnd: Date | string | null;
  unpaidBreakMinutes?: number | null;
  adjustmentMinutes?: number | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Durée prévue, en minutes. */
export function scheduledMinutes(
  start: Date | string,
  end: Date | string,
): number {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return 0;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

/**
 * Durée réellement effectuée, en minutes.
 *
 * Renvoie `null` tant que les heures réelles ne sont pas saisies : c'est ce qui
 * distingue « 0 heure travaillée » de « heures pas encore confirmées ».
 * Le résultat ne descend jamais sous zéro, même si les pauses déclarées
 * dépassent la durée de la garde.
 */
export function workedMinutes(session: SessionTimes): number | null {
  const start = toDate(session.actualStart);
  const end = toDate(session.actualEnd);
  if (!start || !end) return null;

  const gross = Math.floor((end.getTime() - start.getTime()) / 60_000);
  const net =
    gross - (session.unpaidBreakMinutes ?? 0) + (session.adjustmentMinutes ?? 0);
  return Math.max(0, net);
}

/** Arrondi monétaire au centime, sans erreur de virgule flottante visible. */
export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Montant des heures : minutes réalisées × tarif figé de la garde. */
export function hoursAmount(minutes: number | null, hourlyRate: number): number | null {
  if (minutes === null) return null;
  return roundCents((minutes / 60) * hourlyRate);
}

export type SessionForTotals = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  unpaid_break_minutes: number;
  adjustment_minutes: number;
  applied_hourly_rate: number;
  status: string;
};

export type SessionTotals = {
  scheduledMinutes: number;
  workedMinutes: number | null;
  hoursAmount: number | null;
  extrasTotal: number;
  totalAmount: number | null;
};

export function sessionTotals(
  session: SessionForTotals,
  extras: { amount: number }[] = [],
): SessionTotals {
  const worked = workedMinutes({
    actualStart: session.actual_start,
    actualEnd: session.actual_end,
    unpaidBreakMinutes: session.unpaid_break_minutes,
    adjustmentMinutes: session.adjustment_minutes,
  });
  const hours = hoursAmount(worked, session.applied_hourly_rate);
  const extrasTotal = roundCents(
    extras.reduce((sum, extra) => sum + Number(extra.amount || 0), 0),
  );

  return {
    scheduledMinutes: scheduledMinutes(session.scheduled_start, session.scheduled_end),
    workedMinutes: worked,
    hoursAmount: hours,
    extrasTotal,
    totalAmount: hours === null ? null : roundCents(hours + extrasTotal),
  };
}

/* -------------------------------------------------------------------------- */
/* Bilan mensuel                                                              */
/* -------------------------------------------------------------------------- */

export type MonthlySummary = {
  sessionCount: number;
  /** Total des heures prévues, toutes gardes non annulées confondues. */
  scheduledMinutes: number;
  /** Heures réalisées et confirmées : c'est la base du montant dû. */
  confirmedMinutes: number;
  /** Heures saisies mais pas encore confirmées. */
  unconfirmedMinutes: number;
  /** Gardes dont les heures réelles ne sont pas encore renseignées. */
  pendingSessionCount: number;
  pendingScheduledMinutes: number;
  hoursAmount: number;
  extrasTotal: number;
  totalAmount: number;
};

/**
 * Agrège les gardes d'un mois pour une nounou.
 *
 * Le montant n'inclut QUE les gardes confirmées : une estimation ne doit pas
 * mélanger ce qui est validé et ce qui reste à vérifier. Les heures restant à
 * confirmer sont comptées à part et affichées comme telles.
 */
export function monthlySummary(
  entries: { session: SessionForTotals; extras: { amount: number }[] }[],
): MonthlySummary {
  const summary: MonthlySummary = {
    sessionCount: 0,
    scheduledMinutes: 0,
    confirmedMinutes: 0,
    unconfirmedMinutes: 0,
    pendingSessionCount: 0,
    pendingScheduledMinutes: 0,
    hoursAmount: 0,
    extrasTotal: 0,
    totalAmount: 0,
  };

  for (const { session, extras } of entries) {
    if (session.status === 'annulee') continue;

    const totals = sessionTotals(session, extras);
    summary.sessionCount += 1;
    summary.scheduledMinutes += totals.scheduledMinutes;

    if (totals.workedMinutes === null) {
      summary.pendingSessionCount += 1;
      summary.pendingScheduledMinutes += totals.scheduledMinutes;
      continue;
    }

    if (session.status === 'confirmee') {
      summary.confirmedMinutes += totals.workedMinutes;
      summary.hoursAmount = roundCents(summary.hoursAmount + (totals.hoursAmount ?? 0));
      summary.extrasTotal = roundCents(summary.extrasTotal + totals.extrasTotal);
    } else {
      summary.unconfirmedMinutes += totals.workedMinutes;
      summary.pendingSessionCount += 1;
    }
  }

  summary.totalAmount = roundCents(summary.hoursAmount + summary.extrasTotal);
  return summary;
}

/**
 * Tarif applicable à une date, d'après l'historique des tarifs.
 *
 * Utilisé uniquement pour PRÉ-REMPLIR une nouvelle garde. Une fois la garde
 * enregistrée, c'est la valeur copiée dans la garde qui fait foi : changer le
 * tarif par défaut ne rejoue jamais un bilan passé.
 */
export function rateOn(
  rates: { hourly_rate: number; effective_from: string }[],
  day: string,
): number | null {
  const applicable = rates
    .filter((rate) => rate.effective_from <= day)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return applicable.length > 0 ? Number(applicable[0].hourly_rate) : null;
}
