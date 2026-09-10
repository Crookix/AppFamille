'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Baby,
  CalendarDays,
  Pencil,
  Phone,
  Plus,
  School,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Field, Input, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { ChildSheet, formatAge } from '@/components/children/children-manager';
import { EventCard } from '@/components/calendar/event-card';
import { EventDetailSheet } from '@/components/events/event-detail-sheet';
import {
  createChildActivityAction,
  deleteChildActivityAction,
} from '@/lib/actions/children';
import { formatDayLong, formatRelativeDay, formatTime } from '@/lib/datetime';
import { formatDuration } from '@/lib/utils';
import { scheduledMinutes } from '@/lib/childcare';
import type { ChildActivityRow, ChildRow } from '@/lib/database.types';
import type { SerializedOccurrence } from '@/lib/data/calendar';

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

type SessionSummary = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  nanny: { name: string } | null;
};

export function ChildProfile({
  child,
  activities,
  events,
  sessions,
}: {
  child: ChildRow;
  activities: ChildActivityRow[];
  events: SerializedOccurrence[];
  sessions: SessionSummary[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { household, members } = useHousehold();
  const tz = household.timezone;

  const [editing, setEditing] = React.useState(false);
  const [addingActivity, setAddingActivity] = React.useState(false);
  const [selectedEvent, setSelectedEvent] = React.useState<SerializedOccurrence | null>(null);

  const age = formatAge(child.birth_date);

  return (
    <div className="space-y-5">
      <Link
        href="/plus/enfants"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Enfants
      </Link>

      {/* --- Identité ----------------------------------------------------- */}
      <div className="flex items-center gap-4">
        <Avatar name={child.first_name} color={child.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">
            {child.first_name}
          </h1>
          <p className="text-sm text-muted">
            {[
              age,
              child.birth_date
                ? `né·e le ${formatDayLong(child.birth_date, { withYear: true })}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Fiche à compléter'}
          </p>
        </div>
        <Button variant="outline" size="iconSm" onClick={() => setEditing(true)} aria-label="Modifier la fiche">
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* --- Allergies : mises en avant ------------------------------------ */}
      {child.allergies ? (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-xl2)] bg-alert-100 p-3.5 text-alert-700">
          <TriangleAlert className="mt-0.5 h-4.5 w-4.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold">Allergies</p>
            <p className="whitespace-pre-wrap text-sm">{child.allergies}</p>
          </div>
        </div>
      ) : null}

      {/* --- École et contacts --------------------------------------------- */}
      {child.school_name || child.school_contact ? (
        <Card>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <School className="h-4 w-4" aria-hidden />
            École ou crèche
          </h2>
          {child.school_name ? <p className="text-sm">{child.school_name}</p> : null}
          {child.school_contact ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {child.school_contact}
            </p>
          ) : null}
        </Card>
      ) : null}

      {child.notes ? (
        <Card>
          <h2 className="mb-1.5 text-sm font-bold">Notes pratiques</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{child.notes}</p>
        </Card>
      ) : null}

      {/* --- Activités régulières ------------------------------------------ */}
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            Activités régulières
          </h2>
          <button
            type="button"
            onClick={() => setAddingActivity(true)}
            className="text-xs font-bold text-brand-600 underline underline-offset-2"
          >
            Ajouter
          </button>
        </div>

        {activities.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Aucune activité enregistrée (piscine, musique, sport…).
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-[var(--line)] p-0">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{activity.label}</p>
                  <p className="truncate text-xs text-muted">
                    {[
                      activity.weekday ? WEEKDAYS[activity.weekday - 1] : null,
                      activity.start_time
                        ? `${activity.start_time.slice(0, 5)}${
                            activity.end_time ? ` – ${activity.end_time.slice(0, 5)}` : ''
                          }`
                        : null,
                      activity.location,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Retirer ${activity.label}`}
                  onClick={async () => {
                    const result = await deleteChildActivityAction(activity.id, child.id);
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
      </section>

      {/* --- Prochains événements ------------------------------------------ */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Prochains événements
        </h2>
        {events.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Aucun événement à venir associé à {child.first_name}.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {events.map((item) => {
              const dropoff = members.find((m) => m.id === item.event.dropoff_member_id);
              const pickup = members.find((m) => m.id === item.event.pickup_member_id);
              return (
                <div key={item.key}>
                  <p className="mb-1 px-1 text-xs font-bold text-muted first-letter:uppercase">
                    {formatRelativeDay(item.startsAt.slice(0, 10), tz)}
                  </p>
                  <EventCard item={item} onOpen={setSelectedEvent} compact />
                  {dropoff || pickup ? (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 px-1 text-xs text-muted">
                      {dropoff ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar
                            name={dropoff.display_name}
                            color={dropoff.color}
                            size="xs"
                          />
                          accompagne
                        </span>
                      ) : null}
                      {pickup ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar
                            name={pickup.display_name}
                            color={pickup.color}
                            size="xs"
                          />
                          récupère
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* --- Gardes prévues ------------------------------------------------- */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Gardes prévues
        </h2>
        {sessions.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Aucune garde à venir.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-[var(--line)] p-0">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-white/5">
                  <Baby className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {session.nanny?.name ?? 'Garde'}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatRelativeDay(session.scheduled_start.slice(0, 10), tz)} ·{' '}
                    {formatTime(session.scheduled_start, tz)} –{' '}
                    {formatTime(session.scheduled_end, tz)} ·{' '}
                    {formatDuration(
                      scheduledMinutes(session.scheduled_start, session.scheduled_end),
                    )}
                  </p>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <ChildSheet open={editing} onClose={() => setEditing(false)} child={child} />

      <ActivitySheet
        open={addingActivity}
        onClose={() => setAddingActivity(false)}
        childId={child.id}
      />

      <EventDetailSheet
        item={selectedEvent}
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}

function ActivitySheet({
  open,
  onClose,
  childId,
}: {
  open: boolean;
  onClose: () => void;
  childId: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [label, setLabel] = React.useState('');
  const [weekday, setWeekday] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLabel('');
    setWeekday('');
    setStartTime('');
    setEndTime('');
    setLocation('');
  }, [open]);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!label.trim()) return;

    setPending(true);
    const result = await createChildActivityAction(childId, {
      label: label.trim(),
      weekday: weekday ? Number(weekday) : null,
      startTime: startTime || null,
      endTime: endTime || null,
      location,
    });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Activité ajoutée.');
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nouvelle activité"
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} loading={pending}>
            <Plus className="h-4 w-4" aria-hidden />
            Ajouter
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Activité" required>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Piscine"
            maxLength={80}
            required
            data-autofocus
          />
        </Field>

        <Field label="Jour" hint="facultatif">
          <Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            <option value="">Aucun jour fixe</option>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index + 1}>
                {day}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="De" hint="facultatif">
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
          <Field label="À" hint="facultatif">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>

        <Field label="Lieu" hint="facultatif">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Piscine municipale"
            maxLength={120}
          />
        </Field>
      </form>
    </Sheet>
  );
}
