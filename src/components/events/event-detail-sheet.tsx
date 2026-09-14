'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarClock,
  Cloud,
  Clock,
  Download,
  MapPin,
  Pencil,
  Plane,
  Repeat,
  Trash2,
  Users,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge, ErrorNote, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { Avatar } from '@/components/ui/avatar';
import { useSupabase } from '@/components/providers/use-supabase';
import { useHousehold } from '@/components/providers/household-provider';
import { CATEGORY_META, type CategoryKey } from '@/components/events/pickers';
import { EventSheet } from '@/components/events/event-sheet';
import { deleteEventAction, type EditScope } from '@/lib/actions/events';
import { getAttachmentUrlAction } from '@/lib/actions/attachments';
import { describeRecurrence } from '@/lib/recurrence';
import { formatDayLong, formatTime, timezoneLabel } from '@/lib/datetime';
import type { AttachmentRow, TripDetailRow } from '@/lib/database.types';
import type { SerializedOccurrence } from '@/lib/data/calendar';

const TRANSPORT_LABELS: Record<string, string> = {
  train: 'Train',
  avion: 'Avion',
  voiture: 'Voiture',
  bus: 'Bus',
  bateau: 'Bateau',
  velo: 'Vélo',
  autre: 'Autre',
};

/** Lien vers une application de cartes, à partir d'une adresse libre. */
function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function EventDetailSheet({
  item,
  open,
  onClose,
}: {
  item: SerializedOccurrence | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = useSupabase();
  const { members, children, household } = useHousehold();

  const [trip, setTrip] = React.useState<TripDetailRow | null>(null);
  const [attachments, setAttachments] = React.useState<AttachmentRow[]>([]);
  const [reminders, setReminders] = React.useState<number[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleteScope, setDeleteScope] = React.useState<EditScope>('occurrence');
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const eventId = item?.event.id ?? null;

  React.useEffect(() => {
    if (!open || !eventId) return;

    setLoading(true);
    setError(null);
    setConfirmingDelete(false);
    setDeleteScope(item?.isRecurring ? 'occurrence' : 'serie');

    let cancelled = false;
    (async () => {
      const [tripResult, attachmentsResult, remindersResult] = await Promise.all([
        supabase.from('trip_details').select('*').eq('event_id', eventId).maybeSingle(),
        supabase.from('attachments').select('*').eq('event_id', eventId).order('created_at'),
        supabase
          .from('event_reminders')
          .select('minutes_before')
          .eq('event_id', eventId)
          .order('minutes_before'),
      ]);

      if (cancelled) return;
      setTrip(tripResult.data ?? null);
      setAttachments(attachmentsResult.data ?? []);
      setReminders((remindersResult.data ?? []).map((r) => r.minutes_before));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  if (!item) return null;

  const { event } = item;
  const tz = event.timezone || household.timezone;
  const category = CATEGORY_META[event.category as CategoryKey] ?? CATEGORY_META.famille;

  const responsible = members.find((m) => m.id === event.responsible_member_id);
  const dropoff = members.find((m) => m.id === event.dropoff_member_id);
  const pickup = members.find((m) => m.id === event.pickup_member_id);

  const involvedMembers = item.memberIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const involvedChildren = item.childIds
    .map((id) => children.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  async function download(attachment: AttachmentRow) {
    const result = await getAttachmentUrlAction(attachment.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
  }

  async function confirmDelete() {
    setDeleting(true);
    setError(null);

    const result = await deleteEventAction(event.id, {
      scope: deleteScope,
      occurrenceStart: item!.occurrenceStart,
    });

    setDeleting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(
      deleteScope === 'occurrence' && item!.isRecurring
        ? 'Cette occurrence a été supprimée.'
        : 'Événement supprimé.',
    );
    onClose();
    router.refresh();
  }

  return (
    <>
      <Sheet
        open={open && !editing}
        onClose={onClose}
        size="large"
        title={event.is_busy_only ? 'Occupé' : event.title}
        footer={
          confirmingDelete ? (
            <div className="pb-1">
              {item.isRecurring ? (
                <fieldset className="mb-3">
                  <legend className="mb-1.5 text-sm font-semibold">Que supprimer ?</legend>
                  <div className="space-y-1.5">
                    {(
                      [
                        ['occurrence', 'Uniquement cette date'],
                        ['serie', 'Toute la série'],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2.5 text-sm">
                        <input
                          type="radio"
                          name="portee-suppression"
                          checked={deleteScope === value}
                          onChange={() => setDeleteScope(value)}
                          className="h-4 w-4 accent-[var(--color-brand-500)]"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <p className="mb-3 text-sm text-muted">
                  Cet événement et ses pièces jointes seront définitivement supprimés.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Annuler
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={confirmDelete}
                  loading={deleting}
                >
                  Supprimer
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 pb-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Supprimer
              </Button>
              <Button className="flex-1" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Modifier
              </Button>
            </div>
          )
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold text-white"
              style={{ backgroundColor: category.color }}
            >
              {category.label}
            </span>
            {item.isRecurring ? (
              <Badge>
                <Repeat className="h-3 w-3" aria-hidden />
                {describeRecurrence(
                  item.isException ? null : event.recurrence_rule,
                ) ?? 'Occurrence modifiée'}
              </Badge>
            ) : null}
            {event.origin === 'google' ? (
              <Badge tone="brand">
                <Cloud className="h-3 w-3" aria-hidden />
                Google Agenda
              </Badge>
            ) : null}
          </div>

          <div className="rounded-2xl bg-[var(--bg-subtle)] p-3.5">
            <p className="flex items-center gap-2 font-semibold">
              <CalendarClock className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              {formatDayLong(item.startsAt.slice(0, 10))}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted">
              <Clock className="h-4 w-4 shrink-0" aria-hidden />
              {event.all_day
                ? 'Journée entière'
                : `${formatTime(item.startsAt, tz)} – ${formatTime(item.endsAt, tz)}`}
              {!event.all_day ? (
                <span className="text-xs">({timezoneLabel(item.startsAt, tz)})</span>
              ) : null}
            </p>
          </div>

          {event.location || event.address ? (
            <div>
              <p className="mb-1 text-sm font-semibold">Lieu</p>
              <p className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span>
                  {event.location ? <span className="block">{event.location}</span> : null}
                  {event.address ? (
                    <a
                      href={mapsUrl(event.address)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-600 underline underline-offset-2"
                    >
                      {event.address}
                    </a>
                  ) : null}
                </span>
              </p>
            </div>
          ) : null}

          {trip ? (
            <div className="rounded-2xl border border-[var(--line)] p-3.5">
              <p className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                <Plane className="h-4 w-4" aria-hidden />
                {TRANSPORT_LABELS[trip.transport_mode] ?? 'Déplacement'}
                {trip.carrier_number ? ` · ${trip.carrier_number}` : ''}
              </p>

              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Départ
                  </p>
                  <p className="truncate font-semibold">{trip.departure_place ?? '—'}</p>
                  {trip.departure_at ? (
                    <p className="text-sm text-muted">
                      {formatTime(trip.departure_at, trip.departure_tz)}{' '}
                      <span className="text-xs">
                        ({timezoneLabel(trip.departure_at, trip.departure_tz)})
                      </span>
                    </p>
                  ) : null}
                </div>

                <ArrowRight className="mt-5 h-4 w-4 shrink-0 text-muted" aria-hidden />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Arrivée
                  </p>
                  <p className="truncate font-semibold">{trip.arrival_place ?? '—'}</p>
                  {trip.arrival_at ? (
                    <p className="text-sm text-muted">
                      {formatTime(trip.arrival_at, trip.arrival_tz)}{' '}
                      <span className="text-xs">
                        ({timezoneLabel(trip.arrival_at, trip.arrival_tz)})
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>

              {trip.arrival_tz !== trip.departure_tz ? (
                <p className="mt-2 text-xs text-muted">
                  Les horaires sont affichés dans le fuseau de chaque étape.
                </p>
              ) : null}

              {trip.booking_ref || trip.seat_info ? (
                <p className="mt-2.5 text-sm text-muted">
                  {trip.booking_ref ? `Réservation ${trip.booking_ref}` : null}
                  {trip.booking_ref && trip.seat_info ? ' · ' : null}
                  {trip.seat_info}
                </p>
              ) : null}
            </div>
          ) : null}

          {involvedMembers.length > 0 || involvedChildren.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-semibold">Qui est concerné</p>
              <div className="flex flex-wrap gap-2">
                {involvedMembers.map((member) => (
                  <span
                    key={member.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] py-1 pl-1 pr-3 text-sm font-semibold"
                  >
                    <Avatar name={member.display_name} color={member.color} size="xs" />
                    {member.display_name}
                  </span>
                ))}
                {involvedChildren.map((child) => (
                  <span
                    key={child.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] py-1 pl-1 pr-3 text-sm font-semibold"
                  >
                    <Avatar name={child.first_name} color={child.color} size="xs" />
                    {child.first_name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {responsible || dropoff || pickup ? (
            <div className="rounded-2xl bg-[var(--bg-subtle)] p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-4 w-4" aria-hidden />
                Qui s'en occupe
              </p>
              <ul className="space-y-1.5 text-sm">
                {responsible ? (
                  <li className="flex items-center gap-2">
                    <Avatar
                      name={responsible.display_name}
                      color={responsible.color}
                      size="xs"
                    />
                    <span>
                      <strong>{responsible.display_name}</strong> est responsable
                    </span>
                  </li>
                ) : null}
                {dropoff ? (
                  <li className="flex items-center gap-2">
                    <Avatar name={dropoff.display_name} color={dropoff.color} size="xs" />
                    <span>
                      <strong>{dropoff.display_name}</strong> accompagne
                    </span>
                  </li>
                ) : null}
                {pickup ? (
                  <li className="flex items-center gap-2">
                    <Avatar name={pickup.display_name} color={pickup.color} size="xs" />
                    <span>
                      <strong>{pickup.display_name}</strong> récupère
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {event.description ? (
            <div>
              <p className="mb-1 text-sm font-semibold">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-muted">{event.description}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-sm font-semibold">Documents</p>
            {loading ? (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            ) : attachments.length === 0 ? (
              <p className="text-sm text-muted">Aucun document joint.</p>
            ) : (
              <ul className="space-y-1.5">
                {attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <button
                      type="button"
                      onClick={() => download(attachment)}
                      className="flex w-full items-center gap-2.5 rounded-2xl border border-[var(--line)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                    >
                      <Download className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {attachment.file_name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {event.origin === 'google' && attachments.length > 0 ? (
              <p className="mt-2 text-xs text-muted">
                Ces documents restent dans MyFamily et ne sont pas envoyés à Google.
              </p>
            ) : null}
          </div>

          {reminders.length > 0 ? (
            <p className="text-sm text-muted">
              Rappels :{' '}
              {reminders
                .map((m) =>
                  m === 0
                    ? "à l'heure"
                    : m === 1440
                      ? 'la veille'
                      : m >= 60
                        ? `${m / 60} h avant`
                        : `${m} min avant`,
                )
                .join(', ')}
            </p>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </div>
      </Sheet>

      <EventSheet
        open={editing}
        onClose={() => setEditing(false)}
        event={event}
        trip={trip}
        attachments={attachments}
        initialMemberIds={item.memberIds}
        initialChildIds={item.childIds}
        initialReminders={reminders}
        occurrenceStart={item.isRecurring ? item.occurrenceStart : null}
        onSaved={() => {
          setEditing(false);
          onClose();
        }}
      />
    </>
  );
}
