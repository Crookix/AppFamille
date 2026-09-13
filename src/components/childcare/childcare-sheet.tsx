'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Baby, Info } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select, Textarea, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useSupabase } from '@/components/providers/use-supabase';
import { useHousehold } from '@/components/providers/household-provider';
import { RecurrencePicker } from '@/components/events/pickers';
import { Avatar } from '@/components/ui/avatar';
import { createChildcareSessionAction } from '@/lib/actions/childcare';
import { fromLocalInputValue } from '@/lib/datetime';
import { cn, colorHex, formatDuration } from '@/lib/utils';
import { scheduledMinutes } from '@/lib/childcare';
import type { NannyRow } from '@/lib/database.types';

/**
 * Planification d'une garde.
 *
 * Le tarif affiché est celui qui sera FIGÉ dans la garde : on le montre
 * explicitement, car c'est lui qui servira au bilan, même si le tarif par
 * défaut de la nounou change plus tard.
 */
export function ChildcareSheet({
  open,
  onClose,
  defaultDay,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultDay?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = useSupabase();
  const { household, children } = useHousehold();

  const [nannies, setNannies] = React.useState<NannyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [nannyId, setNannyId] = React.useState('');
  const [startLocal, setStartLocal] = React.useState('');
  const [endLocal, setEndLocal] = React.useState('');
  const [childIds, setChildIds] = React.useState<string[]>([]);
  const [location, setLocation] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [rate, setRate] = React.useState<string>('');
  const [defaultRate, setDefaultRate] = React.useState<number | null>(null);
  const [recurrence, setRecurrence] = React.useState<string | null>(null);
  const [recurrenceUntil, setRecurrenceUntil] = React.useState('');

  React.useEffect(() => {
    if (!open) return;

    const day = defaultDay ?? new Date().toISOString().slice(0, 10);
    setStartLocal(`${day}T18:00`);
    setEndLocal(`${day}T21:00`);
    setChildIds(children.map((c) => c.id));
    setLocation('');
    setNotes('');
    setRate('');
    setRecurrence(null);
    setRecurrenceUntil('');
    setError(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('nannies')
        .select('*')
        .eq('household_id', household.id)
        .eq('is_active', true)
        .order('name');

      if (cancelled) return;
      setNannies(data ?? []);
      if (data && data.length > 0) setNannyId(data[0].id);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDay, household.id]);

  /* Récupère le tarif en vigueur à la date choisie, pour l'afficher avant
     enregistrement — c'est lui qui sera figé dans la garde. */
  React.useEffect(() => {
    if (!nannyId || !startLocal) {
      setDefaultRate(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('nanny_rate_at', {
        p_nanny_id: nannyId,
        p_on: startLocal.slice(0, 10),
      });
      if (!cancelled) setDefaultRate(data === null || data === undefined ? null : Number(data));
    })();

    return () => {
      cancelled = true;
    };
  }, [nannyId, startLocal, supabase]);

  const appliedRate = rate.trim() ? Number(rate.replace(',', '.')) : defaultRate;

  const duration =
    startLocal && endLocal
      ? scheduledMinutes(
          fromLocalInputValue(startLocal, household.timezone),
          fromLocalInputValue(endLocal, household.timezone),
        )
      : 0;

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!nannyId) {
      setError('Choisissez une nounou.');
      return;
    }
    if (!startLocal || !endLocal) {
      setError('Indiquez les horaires prévus.');
      return;
    }

    const start = fromLocalInputValue(startLocal, household.timezone);
    const end = fromLocalInputValue(endLocal, household.timezone);

    if (end <= start) {
      setError(
        'La fin doit suivre le début. Pour une garde qui passe minuit, indiquez la date du lendemain.',
      );
      return;
    }

    const parsedRate = rate.trim() ? Number(rate.replace(',', '.')) : null;
    if (parsedRate !== null && (!Number.isFinite(parsedRate) || parsedRate < 0)) {
      setError('Le tarif horaire doit être un nombre positif.');
      return;
    }

    setPending(true);

    const result = await createChildcareSessionAction({
      nannyId,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      childIds,
      location,
      notes,
      hourlyRate: parsedRate,
      recurrenceRule: recurrence,
      recurrenceUntil: recurrenceUntil || null,
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(
      result.data.count > 1
        ? `${result.data.count} gardes planifiées.`
        : 'Garde planifiée et ajoutée au calendrier.',
    );
    onSaved?.();
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Planifier une garde"
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button
            className="flex-1"
            onClick={submit}
            loading={pending}
            disabled={nannies.length === 0}
          >
            Planifier
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : nannies.length === 0 ? (
        <div className="py-4 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Baby className="h-7 w-7" aria-hidden />
          </div>
          <p className="font-bold">Aucune nounou enregistrée</p>
          <p className="mt-1 text-sm text-muted">
            Ajoutez d'abord une fiche avec son tarif horaire : c'est lui qui servira
            au calcul des heures.
          </p>
          <Link
            href="/plus/nounous"
            onClick={onClose}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-brand-500 px-5 font-semibold text-white transition-colors hover:bg-brand-600"
          >
            Ajouter une nounou
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <Field label="Nounou" required>
            <Select value={nannyId} onChange={(e) => setNannyId(e.target.value)} data-autofocus>
              {nannies.map((nanny) => (
                <option key={nanny.id} value={nanny.id}>
                  {nanny.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Début prévu" required>
              <Input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required
              />
            </Field>
            <Field
              label="Fin prévue"
              hint={endLocal.slice(0, 10) !== startLocal.slice(0, 10) ? 'lendemain' : undefined}
              required
            >
              <Input
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                required
              />
            </Field>
          </div>

          {duration > 0 ? (
            <p className="rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5 text-sm">
              Durée prévue : <strong>{formatDuration(duration)}</strong>
              {appliedRate !== null && appliedRate !== undefined && Number.isFinite(appliedRate)
                ? ` · environ ${((duration / 60) * appliedRate).toFixed(2).replace('.', ',')} €`
                : null}
            </p>
          ) : null}

          {children.length > 0 ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Enfants gardés</legend>
              <div className="flex flex-wrap gap-2">
                {children.map((child) => {
                  const selected = childIds.includes(child.id);
                  return (
                    <button
                      key={child.id}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() =>
                        setChildIds((current) =>
                          selected
                            ? current.filter((id) => id !== child.id)
                            : [...current, child.id],
                        )
                      }
                      className={cn(
                        'flex h-10 items-center gap-2 rounded-full border-2 pl-1 pr-3.5 text-sm font-semibold transition-colors',
                        selected
                          ? 'border-transparent text-white'
                          : 'border-[var(--line)] text-[var(--fg)] hover:bg-[var(--bg-subtle)]',
                      )}
                      style={selected ? { backgroundColor: colorHex(child.color) } : undefined}
                    >
                      <Avatar name={child.first_name} color={child.color} size="sm" />
                      {child.first_name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <Field
            label="Tarif horaire appliqué"
            hint={
              defaultRate !== null
                ? `par défaut : ${defaultRate.toFixed(2).replace('.', ',')} €`
                : 'aucun tarif par défaut'
            }
          >
            <Input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder={defaultRate !== null ? defaultRate.toFixed(2) : '12.00'}
            />
          </Field>

          <p className="flex items-start gap-2 rounded-2xl bg-honey-100 px-3.5 py-2.5 text-xs text-honey-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Ce tarif est enregistré dans la garde. Modifier plus tard le tarif de la
              nounou ne changera ni cette garde ni les bilans déjà établis.
            </span>
          </p>

          <Field label="Lieu" hint="facultatif">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="À la maison"
            />
          </Field>

          <div className="rounded-2xl border border-[var(--line)] p-3.5">
            <p className="mb-2 text-sm font-semibold">Garde récurrente</p>
            <p className="mb-3 text-xs text-muted">
              Chaque occurrence devient une garde distincte, avec ses propres heures à
              confirmer.
            </p>
            <RecurrencePicker rule={recurrence} onChange={setRecurrence} />
            {recurrence ? (
              <Field label="Générer jusqu'au" hint="6 mois par défaut" className="mt-3">
                <Input
                  type="date"
                  value={recurrenceUntil}
                  onChange={(e) => setRecurrenceUntil(e.target.value)}
                />
              </Field>
            ) : null}
          </div>

          <Field label="Consignes" hint="facultatif">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Dîner déjà prêt au frigo"
            />
          </Field>

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </form>
      )}
    </Sheet>
  );
}
