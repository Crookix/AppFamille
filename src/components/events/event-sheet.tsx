'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plane, Repeat } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import {
  CategoryPicker,
  MemberSelect,
  PeoplePicker,
  RecurrencePicker,
  ReminderPicker,
  type CategoryKey,
} from '@/components/events/pickers';
import { AttachmentsField, uploadPendingAttachments } from '@/components/events/attachments';
import { createEventAction, updateEventAction, type EditScope } from '@/lib/actions/events';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/datetime';
import type { AttachmentRow, EventRow, TripDetailRow } from '@/lib/database.types';

const TRANSPORTS: { value: string; label: string }[] = [
  { value: 'train', label: 'Train' },
  { value: 'avion', label: 'Avion' },
  { value: 'voiture', label: 'Voiture' },
  { value: 'bus', label: 'Bus' },
  { value: 'bateau', label: 'Bateau' },
  { value: 'velo', label: 'Vélo' },
  { value: 'autre', label: 'Autre' },
];

const TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Athens',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Montreal',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Australia/Sydney',
  'Indian/Reunion',
];

export type EventSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Événement à modifier ; absent pour une création. */
  event?: EventRow | null;
  trip?: TripDetailRow | null;
  attachments?: AttachmentRow[];
  initialMemberIds?: string[];
  initialChildIds?: string[];
  initialReminders?: number[];
  /** Occurrence visée, pour une série. */
  occurrenceStart?: string | null;
  /** Date pré-remplie à la création (depuis le calendrier). */
  defaultDay?: string;
  onSaved?: () => void;
};

/**
 * Formulaire d'événement.
 *
 * L'essentiel tient dans le premier écran : titre, quand, qui. Tout le reste —
 * lieu, responsable, trajets, répétition, rappels, documents — se déplie à la
 * demande. C'est ce qui permet d'ajouter un rendez-vous en trois gestes sans
 * perdre les cas riches.
 */
export function EventSheet({
  open,
  onClose,
  event = null,
  trip = null,
  attachments = [],
  initialMemberIds = [],
  initialChildIds = [],
  initialReminders = [],
  occurrenceStart = null,
  defaultDay,
  onSaved,
}: EventSheetProps) {
  const router = useRouter();
  const toast = useToast();
  const { household, me } = useHousehold();

  const isEditing = Boolean(event);
  const isSeries = Boolean(event?.recurrence_rule);
  const tz = event?.timezone ?? household.timezone;

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showMore, setShowMore] = React.useState(false);
  const [scope, setScope] = React.useState<EditScope>('serie');

  // --- Champs -------------------------------------------------------------
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState<CategoryKey>('famille');
  const [isTrip, setIsTrip] = React.useState(false);
  const [allDay, setAllDay] = React.useState(false);
  const [startLocal, setStartLocal] = React.useState('');
  const [endLocal, setEndLocal] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [responsible, setResponsible] = React.useState<string | null>(null);
  const [dropoff, setDropoff] = React.useState<string | null>(null);
  const [pickup, setPickup] = React.useState<string | null>(null);
  const [recurrence, setRecurrence] = React.useState<string | null>(null);
  const [reminders, setReminders] = React.useState<number[]>([]);
  const [people, setPeople] = React.useState<{ memberIds: string[]; childIds: string[] }>({
    memberIds: [],
    childIds: [],
  });
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);

  // Déplacement
  const [transport, setTransport] = React.useState('train');
  const [departurePlace, setDeparturePlace] = React.useState('');
  const [departureTz, setDepartureTz] = React.useState(tz);
  const [arrivalPlace, setArrivalPlace] = React.useState('');
  const [arrivalTz, setArrivalTz] = React.useState(tz);
  const [carrierNumber, setCarrierNumber] = React.useState('');
  const [bookingRef, setBookingRef] = React.useState('');
  const [seatInfo, setSeatInfo] = React.useState('');

  /* Réinitialise le formulaire à chaque ouverture, pour ne pas hériter d'une
     saisie précédente. */
  React.useEffect(() => {
    if (!open) return;

    if (event) {
      setTitle(event.title);
      setCategory(event.category as CategoryKey);
      setIsTrip(event.kind === 'deplacement');
      setAllDay(event.all_day);
      setStartLocal(toLocalInputValue(event.starts_at, event.timezone));
      setEndLocal(toLocalInputValue(event.ends_at, event.timezone));
      setLocation(event.location ?? '');
      setAddress(event.address ?? '');
      setDescription(event.description ?? '');
      setResponsible(event.responsible_member_id);
      setDropoff(event.dropoff_member_id);
      setPickup(event.pickup_member_id);
      setRecurrence(event.recurrence_rule);
      setReminders(initialReminders);
      setPeople({ memberIds: initialMemberIds, childIds: initialChildIds });
      setShowMore(
        Boolean(event.location || event.address || event.description || event.recurrence_rule),
      );
      setScope(occurrenceStart ? 'occurrence' : 'serie');
    } else {
      const day = defaultDay ?? new Date().toISOString().slice(0, 10);
      setTitle('');
      setCategory('famille');
      setIsTrip(false);
      setAllDay(false);
      setStartLocal(`${day}T09:00`);
      setEndLocal(`${day}T10:00`);
      setLocation('');
      setAddress('');
      setDescription('');
      // Par défaut, la personne qui crée est responsable et concernée : c'est
      // le cas le plus fréquent, et cela reste modifiable.
      setResponsible(me.id);
      setDropoff(null);
      setPickup(null);
      setRecurrence(null);
      setReminders([]);
      setPeople({ memberIds: [me.id], childIds: [] });
      setShowMore(false);
      setScope('serie');
    }

    if (trip) {
      setTransport(trip.transport_mode);
      setDeparturePlace(trip.departure_place ?? '');
      setDepartureTz(trip.departure_tz);
      setArrivalPlace(trip.arrival_place ?? '');
      setArrivalTz(trip.arrival_tz);
      setCarrierNumber(trip.carrier_number ?? '');
      setBookingRef(trip.booking_ref ?? '');
      setSeatInfo(trip.seat_info ?? '');
    } else {
      setTransport('train');
      setDeparturePlace('');
      setDepartureTz(tz);
      setArrivalPlace('');
      setArrivalTz(tz);
      setCarrierNumber('');
      setBookingRef('');
      setSeatInfo('');
    }

    setPendingFiles([]);
    setError(null);
    // Les dépendances sont volontairement limitées à l'ouverture et à
    // l'événement : re-synchroniser à chaque frappe écraserait la saisie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, occurrenceStart]);

  /** Décale la fin quand on avance le début, pour garder la durée. */
  function onStartChange(next: string) {
    if (startLocal && endLocal) {
      const previousStart = new Date(startLocal).getTime();
      const previousEnd = new Date(endLocal).getTime();
      const nextStart = new Date(next).getTime();
      if (
        Number.isFinite(previousStart) &&
        Number.isFinite(previousEnd) &&
        Number.isFinite(nextStart) &&
        previousEnd >= previousStart
      ) {
        const duration = previousEnd - previousStart;
        setEndLocal(new Date(nextStart + duration).toISOString().slice(0, 16));
      }
    }
    setStartLocal(next);
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Donnez un titre à cet événement.');
      return;
    }
    if (!startLocal || !endLocal) {
      setError('Indiquez les dates de début et de fin.');
      return;
    }

    // « Journée entière » : de minuit local au minuit local suivant la fin.
    const startsAt = allDay
      ? fromLocalInputValue(`${startLocal.slice(0, 10)}T00:00`, tz).toISOString()
      : fromLocalInputValue(startLocal, tz).toISOString();

    const endsAt = allDay
      ? (() => {
          const day = new Date(`${endLocal.slice(0, 10)}T00:00:00Z`);
          day.setUTCDate(day.getUTCDate() + 1);
          return fromLocalInputValue(`${day.toISOString().slice(0, 10)}T00:00`, tz).toISOString();
        })()
      : fromLocalInputValue(endLocal, tz).toISOString();

    if (new Date(endsAt) < new Date(startsAt)) {
      setError('La fin ne peut pas précéder le début.');
      return;
    }

    setPending(true);

    const payload = {
      title: title.trim(),
      description,
      category,
      kind: isTrip ? ('deplacement' as const) : ('standard' as const),
      startsAt,
      endsAt,
      allDay,
      timezone: tz,
      location,
      address,
      responsibleMemberId: responsible,
      dropoffMemberId: dropoff,
      pickupMemberId: pickup,
      recurrenceRule: recurrence,
      memberIds: people.memberIds,
      childIds: people.childIds,
      reminders,
      trip: isTrip
        ? {
            transportMode: transport as 'train',
            departurePlace,
            departureAt: startsAt,
            departureTz,
            arrivalPlace,
            arrivalAt: endsAt,
            arrivalTz,
            carrierNumber,
            bookingRef,
            seatInfo,
            notes: null,
          }
        : null,
    };

    const result = event
      ? await updateEventAction(event.id, payload, {
          scope,
          occurrenceStart: occurrenceStart ?? undefined,
        })
      : await createEventAction(payload);

    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    // Les documents mis de côté pendant la création partent maintenant que
    // l'événement possède un identifiant.
    if (pendingFiles.length > 0 && result.data?.id) {
      const upload = await uploadPendingAttachments(
        pendingFiles,
        household.id,
        result.data.id,
        me.user_id,
      );
      if (upload.failed.length > 0) {
        toast.error(
          `Événement enregistré, mais ${upload.failed.length} document(s) n'ont pas pu être envoyés.`,
        );
      }
    }

    setPending(false);
    toast.success(isEditing ? 'Événement modifié.' : 'Événement ajouté.');
    onSaved?.();
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="large"
      title={isEditing ? "Modifier l'événement" : 'Nouvel événement'}
      description={
        isEditing && isSeries
          ? 'Cet événement fait partie d’une série.'
          : undefined
      }
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button
            className="flex-1"
            onClick={submit}
            loading={pending}
            type="submit"
            form="formulaire-evenement"
          >
            {isEditing ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      }
    >
      <form id="formulaire-evenement" onSubmit={submit} className="space-y-5">
        {isEditing && isSeries && occurrenceStart ? (
          <fieldset className="rounded-2xl bg-[var(--bg-subtle)] p-3">
            <legend className="px-1 text-sm font-semibold">Que modifier ?</legend>
            <div className="mt-1 space-y-1.5">
              {(
                [
                  ['occurrence', 'Uniquement cette date'],
                  ['serie', 'Toute la série'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="portee"
                    value={value}
                    checked={scope === value}
                    onChange={() => setScope(value)}
                    className="h-4 w-4 accent-[var(--color-brand-500)]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <Field label="Titre" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Rendez-vous pédiatre"
            maxLength={200}
            required
            data-autofocus
          />
        </Field>

        <CategoryPicker value={category} onChange={setCategory} />

        <div>
          <label className="mb-2 flex items-center gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4.5 w-4.5 accent-[var(--color-brand-500)]"
            />
            Journée entière
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Début" required>
              <Input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? startLocal.slice(0, 10) : startLocal}
                onChange={(e) =>
                  onStartChange(allDay ? `${e.target.value}T00:00` : e.target.value)
                }
                required
              />
            </Field>
            <Field label="Fin" required>
              <Input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? endLocal.slice(0, 10) : endLocal}
                onChange={(e) =>
                  setEndLocal(allDay ? `${e.target.value}T00:00` : e.target.value)
                }
                required
              />
            </Field>
          </div>
          <p className="mt-1 text-xs text-muted">Horaires exprimés en {tz}.</p>
        </div>

        <PeoplePicker
          memberIds={people.memberIds}
          childIds={people.childIds}
          onChange={setPeople}
        />

        <label className="flex items-center gap-2.5 rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={isTrip}
            onChange={(e) => {
              setIsTrip(e.target.checked);
              if (e.target.checked) {
                setCategory('voyage');
                setShowMore(true);
              }
            }}
            className="h-4.5 w-4.5 accent-[var(--color-brand-500)]"
          />
          <Plane className="h-4 w-4" aria-hidden />
          C'est un déplacement
        </label>

        {isTrip ? (
          <div className="space-y-3 rounded-2xl border border-[var(--line)] p-3.5">
            <Field label="Moyen de transport">
              <Select value={transport} onChange={(e) => setTransport(e.target.value)}>
                {TRANSPORTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Départ de">
                <Input
                  value={departurePlace}
                  onChange={(e) => setDeparturePlace(e.target.value)}
                  placeholder="Paris Gare de Lyon"
                />
              </Field>
              <Field label="Fuseau du départ">
                <Select value={departureTz} onChange={(e) => setDepartureTz(e.target.value)}>
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Arrivée à">
                <Input
                  value={arrivalPlace}
                  onChange={(e) => setArrivalPlace(e.target.value)}
                  placeholder="Marseille Saint-Charles"
                />
              </Field>
              <Field
                label="Fuseau de l'arrivée"
                hint={arrivalTz !== departureTz ? 'différent du départ' : undefined}
              >
                <Select value={arrivalTz} onChange={(e) => setArrivalTz(e.target.value)}>
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="N° de train / vol">
                <Input
                  value={carrierNumber}
                  onChange={(e) => setCarrierNumber(e.target.value)}
                  placeholder="TGV 6173"
                />
              </Field>
              <Field label="Réservation">
                <Input
                  value={bookingRef}
                  onChange={(e) => setBookingRef(e.target.value)}
                  placeholder="ABCDEF"
                />
              </Field>
              <Field label="Place">
                <Input
                  value={seatInfo}
                  onChange={(e) => setSeatInfo(e.target.value)}
                  placeholder="Voiture 12, place 45"
                />
              </Field>
            </div>
          </div>
        ) : null}

        {!showMore ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setShowMore(true)}
          >
            Lieu, responsable, répétition, documents…
          </Button>
        ) : (
          <div className="space-y-5 border-t border-[var(--line)] pt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Lieu">
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Cabinet du Dr Martin"
                />
              </Field>
              <Field label="Adresse" hint="pour ouvrir un plan">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="12 rue des Lilas, Lyon"
                />
              </Field>
            </div>

            <MemberSelect
              label="Adulte responsable"
              value={responsible}
              onChange={setResponsible}
              placeholder="Personne en particulier"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <MemberSelect
                label="Qui accompagne"
                value={dropoff}
                onChange={setDropoff}
                placeholder="—"
              />
              <MemberSelect
                label="Qui récupère"
                value={pickup}
                onChange={setPickup}
                placeholder="—"
              />
            </div>

            {!event?.recurring_parent_id ? (
              <div className="rounded-2xl border border-[var(--line)] p-3.5">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <Repeat className="h-4 w-4" aria-hidden />
                  Répétition
                </p>
                <RecurrencePicker rule={recurrence} onChange={setRecurrence} />
              </div>
            ) : null}

            <ReminderPicker reminders={reminders} onChange={setReminders} />

            <Field label="Notes">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Apporter le carnet de santé"
                rows={3}
              />
            </Field>

            <AttachmentsField
              eventId={event?.id ?? null}
              initial={attachments}
              onPendingChange={setPendingFiles}
            />
          </div>
        )}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
