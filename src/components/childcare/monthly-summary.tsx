'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Printer,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { HoursSheet } from '@/components/childcare/hours-sheet';
import { setSettlementStatusAction } from '@/lib/actions/childcare';
import { monthlySummary, sessionTotals } from '@/lib/childcare';
import { buildMonthlyCsv, downloadFile, safeSlug } from '@/lib/exports';
import { formatDuration, formatEuros } from '@/lib/utils';
import { formatDayLong, formatMonthLong, formatTime } from '@/lib/datetime';
import type {
  ChildcareExtraRow,
  ChildcareSessionRow,
  NannyRow,
  NannySettlementRow,
} from '@/lib/database.types';

const STATUS_TONE = {
  prevue: 'neutral',
  a_confirmer: 'honey',
  confirmee: 'sage',
  annulee: 'alert',
} as const;

const STATUS_LABEL = {
  prevue: 'Prévue',
  a_confirmer: 'À confirmer',
  confirmee: 'Confirmée',
  annulee: 'Annulée',
} as const;

/**
 * Bilan mensuel d'une nounou.
 *
 * Présenté comme un suivi et une estimation, jamais comme une fiche de paie :
 * la mention figure à l'écran ET dans les exports, parce que c'est là qu'on
 * risquerait de la prendre pour un document officiel.
 */
export function MonthlySummary({
  nanny,
  month,
  sessions,
  extras,
  sessionChildren,
  settlement,
}: {
  nanny: NannyRow;
  /** Premier jour du mois, aaaa-mm-01. */
  month: string;
  sessions: ChildcareSessionRow[];
  extras: ChildcareExtraRow[];
  sessionChildren: { session_id: string; child_id: string }[];
  settlement: NannySettlementRow | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { household, children } = useHousehold();
  const tz = household.timezone;

  const [editingHours, setEditingHours] = React.useState<ChildcareSessionRow | null>(null);
  const [savingPayment, setSavingPayment] = React.useState(false);

  const extrasBySession = React.useMemo(() => {
    const map = new Map<string, ChildcareExtraRow[]>();
    for (const extra of extras) {
      const list = map.get(extra.session_id) ?? [];
      list.push(extra);
      map.set(extra.session_id, list);
    }
    return map;
  }, [extras]);

  const childNamesBySession = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of sessionChildren) {
      const child = children.find((c) => c.id === link.child_id);
      if (!child) continue;
      const list = map.get(link.session_id) ?? [];
      list.push(child.first_name);
      map.set(link.session_id, list);
    }
    return map;
  }, [sessionChildren, children]);

  const summary = React.useMemo(
    () =>
      monthlySummary(
        sessions.map((session) => ({
          session,
          extras: extrasBySession.get(session.id) ?? [],
        })),
      ),
    [sessions, extrasBySession],
  );

  function shiftMonth(direction: 1 | -1) {
    const [y, m] = month.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1 + direction, 1));
    router.push(
      `/plus/nounous/${nanny.id}?mois=${next.toISOString().slice(0, 7)}`,
    );
  }

  function exportCsv() {
    const csv = buildMonthlyCsv(
      sessions.map((session) => ({
        session,
        extras: extrasBySession.get(session.id) ?? [],
        childNames: childNamesBySession.get(session.id) ?? [],
      })),
      { nannyName: nanny.name, month: formatMonthLong(month), timezone: tz },
    );

    downloadFile(
      csv,
      `bilan-${safeSlug(nanny.name)}-${month.slice(0, 7)}.csv`,
      'text/csv;charset=utf-8',
    );
    toast.success('Export CSV téléchargé.');
  }

  async function togglePaid() {
    setSavingPayment(true);
    const next = settlement?.status === 'paye' ? 'a_payer' : 'paye';
    const result = await setSettlementStatusAction(
      nanny.id,
      month,
      next,
      new Date().toISOString().slice(0, 10),
    );
    setSavingPayment(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(next === 'paye' ? 'Mois marqué comme réglé.' : 'Mois marqué à payer.');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* --- Sélection du mois -------------------------------------------- */}
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => shiftMonth(-1)}
          aria-label="Mois précédent"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Button>
        <h2 className="text-base font-bold first-letter:uppercase">
          {formatMonthLong(month)}
        </h2>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => shiftMonth(1)}
          aria-label="Mois suivant"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Button>
      </div>

      {/* --- Entête d'impression ------------------------------------------ */}
      <div className="hidden print:block">
        <h1 className="text-lg font-bold">
          Bilan des heures — {nanny.name} — {formatMonthLong(month)}
        </h1>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-7 w-7" aria-hidden />}
          title="Aucune garde ce mois-ci"
          description="Les gardes planifiées apparaîtront ici avec leurs heures."
          className="surface"
        />
      ) : (
        <>
          {/* --- Totaux --------------------------------------------------- */}
          <Card className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Heures prévues
                </p>
                <p className="text-lg font-extrabold">
                  {formatDuration(summary.scheduledMinutes)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Heures confirmées
                </p>
                <p className="text-lg font-extrabold text-sage-700">
                  {formatDuration(summary.confirmedMinutes)}
                </p>
              </div>
            </div>

            <div className="border-t border-[var(--line)] pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">
                Montant estimé
              </p>
              <p className="text-2xl font-extrabold">{formatEuros(summary.totalAmount)}</p>
              <p className="text-sm text-muted">
                {formatEuros(summary.hoursAmount)} d'heures
                {summary.extrasTotal > 0
                  ? ` + ${formatEuros(summary.extrasTotal)} de frais`
                  : ''}
              </p>
            </div>

            {summary.pendingSessionCount > 0 ? (
              <p className="flex items-start gap-2 rounded-2xl bg-honey-100 px-3.5 py-2.5 text-sm text-honey-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {summary.pendingSessionCount} garde
                  {summary.pendingSessionCount > 1 ? 's' : ''} en attente de
                  confirmation
                  {summary.unconfirmedMinutes > 0
                    ? ` (${formatDuration(summary.unconfirmedMinutes)} saisies)`
                    : ''}
                  {summary.pendingScheduledMinutes > 0
                    ? `, ${formatDuration(summary.pendingScheduledMinutes)} prévues non saisies`
                    : ''}
                  . Le montant ci-dessus ne les compte pas.
                </span>
              </p>
            ) : null}
          </Card>

          {/* --- Règlement ------------------------------------------------- */}
          <Card className="print:hidden">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  settlement?.status === 'paye'
                    ? 'bg-sage-100 text-sage-700'
                    : 'bg-[var(--bg-subtle)] text-muted'
                }`}
              >
                {settlement?.status === 'paye' ? (
                  <CheckCircle2 className="h-5 w-5" aria-hidden />
                ) : (
                  <Wallet className="h-5 w-5" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">
                  {settlement?.status === 'paye' ? 'Réglé' : 'À régler'}
                </p>
                {settlement?.paid_at ? (
                  <p className="text-xs text-muted">
                    Le {formatDayLong(settlement.paid_at, { withYear: true })}
                  </p>
                ) : null}
              </div>
              <Button
                variant={settlement?.status === 'paye' ? 'outline' : 'sage'}
                size="sm"
                onClick={togglePaid}
                loading={savingPayment}
              >
                {settlement?.status === 'paye' ? 'Annuler' : 'Marquer réglé'}
              </Button>
            </div>
          </Card>

          {/* --- Détail des gardes ---------------------------------------- */}
          <section>
            <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
              Détail des gardes
            </h3>
            <div className="space-y-2">
              {sessions.map((session) => {
                const sessionExtras = extrasBySession.get(session.id) ?? [];
                const totals = sessionTotals(session, sessionExtras);
                const names = childNamesBySession.get(session.id) ?? [];

                return (
                  <Card key={session.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold first-letter:uppercase">
                          {formatDayLong(session.scheduled_start.slice(0, 10))}
                        </p>
                        <p className="text-xs text-muted">
                          Prévu {formatTime(session.scheduled_start, tz)} –{' '}
                          {formatTime(session.scheduled_end, tz)} (
                          {formatDuration(session.scheduled_minutes)})
                          {names.length > 0 ? ` · ${names.join(', ')}` : ''}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[session.status]}>
                        {STATUS_LABEL[session.status]}
                      </Badge>
                    </div>

                    {session.actual_start && session.actual_end ? (
                      <p className="mt-1.5 text-sm">
                        Réalisé {formatTime(session.actual_start, tz)} –{' '}
                        {formatTime(session.actual_end, tz)}
                        {session.unpaid_break_minutes > 0
                          ? ` · ${session.unpaid_break_minutes} min de pause`
                          : ''}
                        {' → '}
                        <strong>{formatDuration(totals.workedMinutes ?? 0)}</strong>
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm text-honey-700">
                        Heures réelles non saisies.
                      </p>
                    )}

                    {session.adjustment_minutes !== 0 ? (
                      <p className="mt-1 text-xs text-muted">
                        Correction manuelle de {session.adjustment_minutes > 0 ? '+' : ''}
                        {session.adjustment_minutes} min
                        {session.adjustment_reason ? ` — ${session.adjustment_reason}` : ''}
                      </p>
                    ) : null}

                    {sessionExtras.length > 0 ? (
                      <p className="mt-1 text-xs text-muted">
                        Frais :{' '}
                        {sessionExtras
                          .map((e) => `${e.label} ${formatEuros(Number(e.amount))}`)
                          .join(' · ')}
                      </p>
                    ) : null}

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-sm">
                        {formatEuros(Number(session.applied_hourly_rate))}/h
                        {totals.totalAmount !== null ? (
                          <>
                            {' → '}
                            <strong>{formatEuros(totals.totalAmount)}</strong>
                          </>
                        ) : null}
                      </p>
                      <Button
                        variant={session.status === 'confirmee' ? 'ghost' : 'secondary'}
                        size="sm"
                        onClick={() => setEditingHours(session)}
                        className="print:hidden"
                      >
                        {session.actual_start ? 'Modifier les heures' : 'Saisir les heures'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* --- Exports --------------------------------------------------- */}
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" className="flex-1" onClick={exportCsv}>
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden />
              Export PDF
            </Button>
          </div>
        </>
      )}

      <p className="rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-muted">
        Ce bilan est un suivi des heures et une estimation du montant. Ce n'est
        ni une fiche de paie ni une déclaration officielle.
      </p>

      <HoursSheet
        open={Boolean(editingHours)}
        onClose={() => setEditingHours(null)}
        session={editingHours}
        nannyName={nanny.name}
        extras={editingHours ? (extrasBySession.get(editingHours.id) ?? []) : []}
      />
    </div>
  );
}
