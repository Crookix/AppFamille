'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, ErrorNote, Field, Input } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { NannySheet } from '@/components/childcare/nannies-manager';
import { MonthlySummary } from '@/components/childcare/monthly-summary';
import {
  archiveNannyAction,
  deleteNannyRateAction,
  setNannyRateAction,
} from '@/lib/actions/childcare';
import { formatEuros } from '@/lib/utils';
import { formatDayLong } from '@/lib/datetime';
import type {
  ChildcareExtraRow,
  ChildcareSessionRow,
  NannyRateRow,
  NannyRow,
  NannySettlementRow,
} from '@/lib/database.types';

export function NannyDetail({
  nanny,
  rates,
  month,
  sessions,
  extras,
  sessionChildren,
  settlement,
}: {
  nanny: NannyRow;
  rates: NannyRateRow[];
  month: string;
  sessions: ChildcareSessionRow[];
  extras: ChildcareExtraRow[];
  sessionChildren: { session_id: string; child_id: string }[];
  settlement: NannySettlementRow | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [editing, setEditing] = React.useState(false);
  const [addingRate, setAddingRate] = React.useState(false);
  const [confirmingArchive, setConfirmingArchive] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const currentRate = rates.find((r) => r.effective_from <= today) ?? null;

  async function archive() {
    setPending(true);
    const result = await archiveNannyAction(nanny.id, false);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Fiche archivée.');
    router.push('/plus/nounous');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Link
        href="/plus/nounous"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-[var(--fg)] print:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Nounous
      </Link>

      <div className="flex items-center gap-4">
        <Avatar name={nanny.name} color={nanny.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">{nanny.name}</h1>
          <p className="text-sm text-muted">
            {currentRate
              ? `${formatEuros(Number(currentRate.hourly_rate))}/h actuellement`
              : 'Aucun tarif renseigné'}
          </p>
        </div>
        <Button
          variant="outline"
          size="iconSm"
          onClick={() => setEditing(true)}
          aria-label="Modifier la fiche"
          className="print:hidden"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {nanny.phone || nanny.email ? (
        <Card className="flex flex-wrap gap-x-5 gap-y-2 print:hidden">
          {nanny.phone ? (
            <a
              href={`tel:${nanny.phone}`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600"
            >
              <Phone className="h-4 w-4" aria-hidden />
              {nanny.phone}
            </a>
          ) : null}
          {nanny.email ? (
            <a
              href={`mailto:${nanny.email}`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600"
            >
              <Mail className="h-4 w-4" aria-hidden />
              {nanny.email}
            </a>
          ) : null}
        </Card>
      ) : null}

      {nanny.notes ? (
        <Card className="print:hidden">
          <h2 className="mb-1.5 text-sm font-bold">Consignes</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{nanny.notes}</p>
        </Card>
      ) : null}

      {/* --- Historique des tarifs ----------------------------------------- */}
      <section className="print:hidden">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            Tarifs horaires
          </h2>
          <button
            type="button"
            onClick={() => setAddingRate(true)}
            className="text-xs font-bold text-brand-600 underline underline-offset-2"
          >
            Nouveau tarif
          </button>
        </div>

        {rates.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Aucun tarif. Sans tarif, aucune garde ne peut être planifiée.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-[var(--line)] p-0">
            {rates.map((rate) => (
              <div key={rate.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {formatEuros(Number(rate.hourly_rate))}/h
                    {rate.id === currentRate?.id ? (
                      <span className="ml-2 rounded-full bg-sage-100 px-2 py-0.5 text-[0.65rem] font-bold text-sage-700">
                        en vigueur
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    À partir du {formatDayLong(rate.effective_from, { withYear: true })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Supprimer le tarif du ${rate.effective_from}`}
                  onClick={async () => {
                    const result = await deleteNannyRateAction(rate.id, nanny.id);
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    router.refresh();
                  }}
                >
                  <Trash2 className="h-4 w-4 text-muted" aria-hidden />
                </Button>
              </div>
            ))}
          </Card>
        )}

        <p className="mt-2 flex items-start gap-2 px-1 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Chaque garde conserve le tarif qui lui a été appliqué. Ajouter un
            nouveau tarif ne modifie jamais un bilan déjà établi.
          </span>
        </p>
      </section>

      {/* --- Bilan mensuel ------------------------------------------------- */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted print:hidden">
          Bilan mensuel
        </h2>
        <MonthlySummary
          nanny={nanny}
          month={month}
          sessions={sessions}
          extras={extras}
          sessionChildren={sessionChildren}
          settlement={settlement}
        />
      </section>

      <Button
        variant="ghost"
        className="w-full print:hidden"
        onClick={() => setConfirmingArchive(true)}
      >
        Archiver cette fiche
      </Button>

      <NannySheet open={editing} onClose={() => setEditing(false)} nanny={nanny} />

      <RateSheet
        open={addingRate}
        onClose={() => setAddingRate(false)}
        nannyId={nanny.id}
      />

      <Sheet
        open={confirmingArchive}
        onClose={() => setConfirmingArchive(false)}
        title="Archiver cette fiche ?"
        footer={
          <div className="flex gap-2 pb-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmingArchive(false)}
            >
              Annuler
            </Button>
            <Button variant="danger" className="flex-1" onClick={archive} loading={pending}>
              Archiver
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          La fiche n'apparaîtra plus dans les listes, mais toutes les gardes passées,
          leurs heures et leurs montants restent consultables.
        </p>
      </Sheet>
    </div>
  );
}

function RateSheet({
  open,
  onClose,
  nannyId,
}: {
  open: boolean;
  onClose: () => void;
  nannyId: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [rate, setRate] = React.useState('');
  const [effectiveFrom, setEffectiveFrom] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRate('');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setError(null);
  }, [open]);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    const parsed = Number(rate.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Le tarif doit être un nombre positif.');
      return;
    }
    if (!effectiveFrom) {
      setError("Indiquez la date d'effet.");
      return;
    }

    setPending(true);
    const result = await setNannyRateAction(nannyId, parsed, effectiveFrom);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success('Tarif enregistré.');
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nouveau tarif horaire"
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} loading={pending}>
            <Plus className="h-4 w-4" aria-hidden />
            Enregistrer
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tarif horaire" hint="en euros" required>
          <Input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder="13.50"
            required
            data-autofocus
          />
        </Field>

        <Field label="À partir du" required>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
        </Field>

        <p className="flex items-start gap-2 rounded-2xl bg-honey-100 px-3.5 py-2.5 text-xs text-honey-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Ce tarif s'appliquera aux gardes créées à partir de cette date. Les gardes
            déjà enregistrées gardent le leur.
          </span>
        </p>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
