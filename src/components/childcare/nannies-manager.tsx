'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Baby, ChevronRight, Plus } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorNote, Field, Input, Textarea } from '@/components/ui/primitives';
import { Avatar, ColorPicker } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { ChildcareSheet } from '@/components/childcare/childcare-sheet';
import { HoursSheet } from '@/components/childcare/hours-sheet';
import { createNannyAction, updateNannyAction } from '@/lib/actions/childcare';
import { MEMBER_COLORS } from '@/lib/utils';
import { formatEuros, formatDuration } from '@/lib/utils';
import { formatRelativeDay, formatTime } from '@/lib/datetime';
import { useHousehold } from '@/components/providers/household-provider';
import type {
  ChildcareExtraRow,
  ChildcareSessionRow,
  NannyRateRow,
  NannyRow,
} from '@/lib/database.types';

export function NanniesManager({
  nannies,
  rates,
  toConfirm,
  upcoming,
  extras,
}: {
  nannies: NannyRow[];
  rates: NannyRateRow[];
  toConfirm: ChildcareSessionRow[];
  upcoming: ChildcareSessionRow[];
  extras: ChildcareExtraRow[];
}) {
  const { household } = useHousehold();
  const tz = household.timezone;

  const [creating, setCreating] = React.useState(false);
  const [planning, setPlanning] = React.useState(false);
  const [editingHours, setEditingHours] = React.useState<ChildcareSessionRow | null>(null);

  function nannyName(nannyId: string) {
    return nannies.find((n) => n.id === nannyId)?.name ?? 'Nounou';
  }

  function currentRate(nannyId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const applicable = rates
      .filter((r) => r.nanny_id === nannyId && r.effective_from <= today)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return applicable[0] ?? null;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight">Nounous et gardes</h1>
        {nannies.length > 0 ? (
          <Button size="sm" onClick={() => setPlanning(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Garde
          </Button>
        ) : null}
      </div>

      {/* --- Heures à confirmer -------------------------------------------- */}
      {toConfirm.length > 0 ? (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-honey-700">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            Heures à saisir ou confirmer
          </h2>
          <div className="space-y-2">
            {toConfirm.map((session) => (
              <Card key={session.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {nannyName(session.nanny_id)}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {formatRelativeDay(session.scheduled_start.slice(0, 10), tz)} ·{' '}
                      {formatTime(session.scheduled_start, tz)} –{' '}
                      {formatTime(session.scheduled_end, tz)} ·{' '}
                      {formatDuration(session.scheduled_minutes)} prévues
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setEditingHours(session)}>
                    {session.actual_start ? 'Confirmer' : 'Saisir'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* --- Gardes à venir ------------------------------------------------- */}
      {upcoming.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Gardes à venir
          </h2>
          <Card className="divide-y divide-[var(--line)] p-0">
            {upcoming.map((session) => (
              <div key={session.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-white/5">
                  <Baby className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {nannyName(session.nanny_id)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatRelativeDay(session.scheduled_start.slice(0, 10), tz)} ·{' '}
                    {formatTime(session.scheduled_start, tz)} –{' '}
                    {formatTime(session.scheduled_end, tz)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {formatDuration(session.scheduled_minutes)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {/* --- Fiches ---------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Fiches
        </h2>

        {nannies.length === 0 ? (
          <EmptyState
            icon={<Baby className="h-7 w-7" aria-hidden />}
            title="Aucune nounou"
            description="Ajoutez une fiche avec son tarif horaire : c'est lui qui servira au calcul des heures et des bilans."
            className="surface"
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Ajouter une nounou
              </Button>
            }
          />
        ) : (
          <Card className="divide-y divide-[var(--line)] p-0">
            {nannies.map((nanny) => {
              const rate = currentRate(nanny.id);
              return (
                <Link
                  key={nanny.id}
                  href={`/plus/nounous/${nanny.id}`}
                  className="flex items-center gap-3.5 px-4 py-3 transition-colors first:rounded-t-[var(--radius-xl2)] last:rounded-b-[var(--radius-xl2)] hover:bg-[var(--bg-subtle)]"
                >
                  <Avatar name={nanny.name} color={nanny.color} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{nanny.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {rate
                        ? `${formatEuros(Number(rate.hourly_rate))}/h`
                        : 'Tarif à renseigner'}
                      {nanny.phone ? ` · ${nanny.phone}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                </Link>
              );
            })}
          </Card>
        )}

        {nannies.length > 0 ? (
          <Button variant="outline" className="mt-3 w-full" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Ajouter une nounou
          </Button>
        ) : null}
      </section>

      <NannySheet open={creating} onClose={() => setCreating(false)} />
      <ChildcareSheet open={planning} onClose={() => setPlanning(false)} />
      <HoursSheet
        open={Boolean(editingHours)}
        onClose={() => setEditingHours(null)}
        session={editingHours}
        nannyName={editingHours ? nannyName(editingHours.nanny_id) : ''}
        extras={
          editingHours ? extras.filter((e) => e.session_id === editingHours.id) : []
        }
      />
    </div>
  );
}

/** Fiche nounou : coordonnées, couleur, tarif initial. */
export function NannySheet({
  open,
  onClose,
  nanny,
}: {
  open: boolean;
  onClose: () => void;
  nanny?: NannyRow | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [color, setColor] = React.useState('lavande');
  const [notes, setNotes] = React.useState('');
  const [rate, setRate] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);

    if (nanny) {
      setName(nanny.name);
      setPhone(nanny.phone ?? '');
      setEmail(nanny.email ?? '');
      setColor(nanny.color);
      setNotes(nanny.notes ?? '');
      setRate('');
    } else {
      setName('');
      setPhone('');
      setEmail('');
      setColor('lavande');
      setNotes('');
      setRate('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nanny?.id]);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Le nom est obligatoire.');
      return;
    }

    const parsedRate = rate.trim() ? Number(rate.replace(',', '.')) : null;
    if (parsedRate !== null && (!Number.isFinite(parsedRate) || parsedRate < 0)) {
      setError('Le tarif horaire doit être un nombre positif.');
      return;
    }

    setPending(true);

    const payload = {
      name: name.trim(),
      phone,
      email,
      color,
      notes,
      hourlyRate: parsedRate,
    };

    const result = nanny
      ? await updateNannyAction(nanny.id, payload)
      : await createNannyAction(payload);

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(nanny ? 'Fiche modifiée.' : 'Nounou ajoutée.');
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={nanny ? `Modifier ${nanny.name}` : 'Nouvelle nounou'}
      description="Aucun compte n'est créé : la nounou n'a rien à installer."
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} loading={pending}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={name || '?'} color={color} size="lg" />
          <div className="min-w-0 flex-1">
            <Field label="Nom" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                data-autofocus
              />
            </Field>
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">Couleur</span>
          <ColorPicker value={color} onChange={setColor} options={MEMBER_COLORS} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Téléphone" hint="facultatif">
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
            />
          </Field>
          <Field label="E-mail" hint="facultatif">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={160}
            />
          </Field>
        </div>

        {!nanny ? (
          <Field
            label="Tarif horaire"
            hint="en euros — modifiable ensuite, sans toucher aux gardes passées"
          >
            <Input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="12.00"
            />
          </Field>
        ) : null}

        <Field label="Consignes et notes" hint="facultatif">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Disponible les mardis et jeudis"
          />
        </Field>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
