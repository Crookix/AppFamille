'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Info, Plus, Trash2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { adjustChildcareAction, saveChildcareHoursAction } from '@/lib/actions/childcare';
import { hoursAmount, workedMinutes } from '@/lib/childcare';
import { formatDuration, formatEuros } from '@/lib/utils';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/datetime';
import type { ChildcareExtraRow, ChildcareSessionRow } from '@/lib/database.types';

type DraftExtra = { key: string; label: string; amount: string };

/**
 * Saisie des heures réellement effectuées.
 *
 * Les horaires PRÉVUS restent affichés en permanence à côté des heures
 * réelles : c'est la comparaison qui a de la valeur, pas la seule valeur
 * finale. Les champs sont pré-remplis avec le prévu, puisque dans la plupart
 * des cas la garde s'est déroulée comme convenu.
 */
export function HoursSheet({
  open,
  onClose,
  session,
  nannyName,
  extras,
}: {
  open: boolean;
  onClose: () => void;
  session: ChildcareSessionRow | null;
  nannyName: string;
  extras: ChildcareExtraRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { household } = useHousehold();
  const tz = household.timezone;

  const [startLocal, setStartLocal] = React.useState('');
  const [endLocal, setEndLocal] = React.useState('');
  const [breakMinutes, setBreakMinutes] = React.useState('0');
  const [draftExtras, setDraftExtras] = React.useState<DraftExtra[]>([]);
  const [adjustment, setAdjustment] = React.useState('0');
  const [adjustmentReason, setAdjustmentReason] = React.useState('');
  const [showAdjustment, setShowAdjustment] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !session) return;

    setStartLocal(
      toLocalInputValue(session.actual_start ?? session.scheduled_start, tz),
    );
    setEndLocal(toLocalInputValue(session.actual_end ?? session.scheduled_end, tz));
    setBreakMinutes(String(session.unpaid_break_minutes ?? 0));
    setAdjustment(String(session.adjustment_minutes ?? 0));
    setAdjustmentReason(session.adjustment_reason ?? '');
    setShowAdjustment((session.adjustment_minutes ?? 0) !== 0);
    setDraftExtras(
      extras.map((extra) => ({
        key: extra.id,
        label: extra.label,
        amount: String(extra.amount),
      })),
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id]);

  if (!session) return null;

  const previewMinutes =
    startLocal && endLocal
      ? workedMinutes({
          actualStart: fromLocalInputValue(startLocal, tz),
          actualEnd: fromLocalInputValue(endLocal, tz),
          unpaidBreakMinutes: Number(breakMinutes) || 0,
          adjustmentMinutes: Number(adjustment) || 0,
        })
      : null;

  const previewExtras = draftExtras.reduce(
    (sum, extra) => sum + (Number(extra.amount.replace(',', '.')) || 0),
    0,
  );
  const previewHours = hoursAmount(previewMinutes, Number(session.applied_hourly_rate));

  const crossesMidnight = startLocal.slice(0, 10) !== endLocal.slice(0, 10);

  async function save(confirm: boolean) {
    setError(null);

    if (!startLocal || !endLocal) {
      setError('Indiquez les horaires réellement effectués.');
      return;
    }

    const start = fromLocalInputValue(startLocal, tz);
    const end = fromLocalInputValue(endLocal, tz);

    if (end <= start) {
      setError(
        'La fin doit suivre le début. Si la garde a passé minuit, mettez la date du lendemain.',
      );
      return;
    }

    const parsedBreak = Number(breakMinutes);
    if (!Number.isInteger(parsedBreak) || parsedBreak < 0) {
      setError('Les pauses doivent être un nombre entier de minutes, positif ou nul.');
      return;
    }

    for (const extra of draftExtras) {
      if (extra.label.trim() && !Number.isFinite(Number(extra.amount.replace(',', '.')))) {
        setError(`Montant invalide pour « ${extra.label} ».`);
        return;
      }
      if (!extra.label.trim() && extra.amount.trim()) {
        setError('Chaque frais doit avoir un libellé.');
        return;
      }
    }

    setPending(true);

    const result = await saveChildcareHoursAction(session!.id, {
      actualStart: start.toISOString(),
      actualEnd: end.toISOString(),
      unpaidBreakMinutes: parsedBreak,
      confirm,
      extras: draftExtras
        .filter((extra) => extra.label.trim())
        .map((extra) => ({
          label: extra.label.trim(),
          amount: Number(extra.amount.replace(',', '.')) || 0,
        })),
    });

    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    // La correction manuelle est enregistrée à part, avec sa trace.
    const parsedAdjustment = Number(adjustment) || 0;
    if (parsedAdjustment !== (session!.adjustment_minutes ?? 0)) {
      if (parsedAdjustment !== 0 && !adjustmentReason.trim()) {
        setPending(false);
        setError('Une correction manuelle doit être motivée.');
        return;
      }
      const adjustResult = await adjustChildcareAction(
        session!.id,
        parsedAdjustment,
        adjustmentReason.trim(),
      );
      if (!adjustResult.ok) {
        setPending(false);
        setError(adjustResult.error);
        return;
      }
    }

    setPending(false);
    toast.success(confirm ? 'Heures confirmées.' : 'Heures enregistrées.');
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="large"
      title={`Heures — ${nannyName}`}
      footer={
        <div className="flex gap-2 pb-1">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => save(false)}
            disabled={pending}
          >
            Enregistrer
          </Button>
          <Button className="flex-1" onClick={() => save(true)} loading={pending}>
            Confirmer
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl bg-[var(--bg-subtle)] p-3.5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Prévu</p>
          <p className="mt-1 text-sm">
            {toLocalInputValue(session.scheduled_start, tz).replace('T', ' à ')} →{' '}
            {toLocalInputValue(session.scheduled_end, tz).replace('T', ' à ')}
            <span className="ml-2 font-semibold">
              ({formatDuration(session.scheduled_minutes)})
            </span>
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrivée réelle" required>
            <Input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              data-autofocus
            />
          </Field>
          <Field label="Départ réel" hint={crossesMidnight ? 'lendemain' : undefined} required>
            <Input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Pauses non rémunérées" hint="en minutes">
          <Input
            type="number"
            min={0}
            step={5}
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
          />
        </Field>

        {previewMinutes !== null ? (
          <div className="rounded-2xl bg-sage-100 p-3.5 text-sage-700">
            <p className="text-xs font-bold uppercase tracking-wide">Réalisé</p>
            <p className="mt-1 text-lg font-extrabold">
              {formatDuration(previewMinutes)}
            </p>
            <p className="mt-0.5 text-sm">
              {formatEuros(Number(session.applied_hourly_rate))}/h ·{' '}
              {previewHours !== null ? formatEuros(previewHours) : '—'}
              {previewExtras > 0 ? (
                <>
                  {' '}
                  + {formatEuros(previewExtras)} de frais ={' '}
                  <strong>{formatEuros((previewHours ?? 0) + previewExtras)}</strong>
                </>
              ) : null}
            </p>
            {crossesMidnight ? (
              <p className="mt-1.5 text-xs">
                Cette garde passe minuit — la durée est comptée sur les deux jours.
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Frais complémentaires</legend>
          <div className="space-y-2">
            {draftExtras.map((extra, index) => (
              <div key={extra.key} className="flex items-center gap-2">
                <Input
                  value={extra.label}
                  onChange={(e) =>
                    setDraftExtras((current) =>
                      current.map((x) =>
                        x.key === extra.key ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Transport"
                  aria-label={`Libellé du frais ${index + 1}`}
                  maxLength={80}
                />
                <Input
                  value={extra.amount}
                  onChange={(e) =>
                    setDraftExtras((current) =>
                      current.map((x) =>
                        x.key === extra.key ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                  inputMode="decimal"
                  placeholder="5"
                  aria-label={`Montant du frais ${index + 1}`}
                  className="w-24 shrink-0"
                />
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() =>
                    setDraftExtras((current) => current.filter((x) => x.key !== extra.key))
                  }
                  aria-label={`Retirer le frais ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4 text-muted" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={() =>
              setDraftExtras((current) => [
                ...current,
                { key: `x${Date.now()}`, label: '', amount: '' },
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            Ajouter un frais
          </Button>
        </fieldset>

        {!showAdjustment ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setShowAdjustment(true)}
          >
            Appliquer une correction manuelle
          </Button>
        ) : (
          <div className="space-y-3 rounded-2xl border border-[var(--line)] p-3.5">
            <p className="flex items-start gap-2 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                La correction s'ajoute aux heures saisies sans les modifier, et reste
                visible dans le bilan avec son motif.
              </span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Correction" hint="minutes, + ou −">
                <Input
                  type="number"
                  step={5}
                  value={adjustment}
                  onChange={(e) => setAdjustment(e.target.value)}
                />
              </Field>
              <Field label="Motif" required={Number(adjustment) !== 0}>
                <Input
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Retard de notre part"
                  maxLength={300}
                />
              </Field>
            </div>
          </div>
        )}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </Sheet>
  );
}
