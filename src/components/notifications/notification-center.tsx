'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Baby,
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  ListChecks,
  RefreshCw,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useSupabase } from '@/components/providers/use-supabase';
import { useHousehold } from '@/components/providers/household-provider';
import {
  deleteNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  updateNotificationPreferencesAction,
} from '@/lib/actions/notifications';
import { cn } from '@/lib/utils';
import { formatRelativeDay, formatTime } from '@/lib/datetime';
import type {
  NotificationKind,
  NotificationPreferenceRow,
  NotificationRow,
} from '@/lib/database.types';

const ICONS: Record<NotificationKind, React.ElementType> = {
  tache_attribuee: ListChecks,
  tache_terminee: CheckCheck,
  evenement_modifie: CalendarClock,
  evenement_ajoute: CalendarClock,
  rappel: Bell,
  garde_a_confirmer: Baby,
  invitation_acceptee: UserPlus,
  sync_google: RefreshCw,
};

const PREFERENCE_FIELDS = [
  {
    key: 'tasks_assigned' as const,
    field: 'tasksAssigned' as const,
    label: 'Une tâche m’est attribuée',
  },
  {
    key: 'tasks_completed' as const,
    field: 'tasksCompleted' as const,
    label: 'Une tâche est terminée par quelqu’un',
  },
  {
    key: 'events_changed' as const,
    field: 'eventsChanged' as const,
    label: 'Un événement est ajouté ou modifié',
  },
  {
    key: 'event_reminders' as const,
    field: 'eventReminders' as const,
    label: 'Rappels avant un événement',
  },
  {
    key: 'childcare_to_confirm' as const,
    field: 'childcareToConfirm' as const,
    label: 'Une garde attend ses heures',
  },
  {
    key: 'google_sync_errors' as const,
    field: 'googleSyncErrors' as const,
    label: 'La synchronisation Google échoue',
  },
];

export function NotificationCenter({
  notifications,
  preferences,
}: {
  notifications: NotificationRow[];
  preferences: NotificationPreferenceRow | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = useSupabase();
  const { household, me } = useHousehold();

  const [items, setItems] = React.useState(notifications);
  const [prefs, setPrefs] = React.useState(preferences);
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => setItems(notifications), [notifications]);

  /* Les notifications arrivent en direct : une tâche attribuée par l'autre
     adulte apparaît sans recharger la page. */
  React.useEffect(() => {
    const channel = supabase
      .channel(`notifications-${me.user_id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${me.user_id}`,
        },
        (payload) => {
          setItems((current) => [payload.new as NotificationRow, ...current]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, me.user_id]);

  const unread = items.filter((n) => !n.read_at);

  async function markRead(notification: NotificationRow) {
    if (notification.read_at) return;

    setItems((current) =>
      current.map((n) =>
        n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n,
      ),
    );
    await markNotificationReadAction(notification.id);
    router.refresh();
  }

  async function markAll() {
    const stamp = new Date().toISOString();
    setItems((current) => current.map((n) => ({ ...n, read_at: n.read_at ?? stamp })));

    const result = await markAllNotificationsReadAction();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function remove(notificationId: string) {
    setItems((current) => current.filter((n) => n.id !== notificationId));
    await deleteNotificationAction(notificationId);
    router.refresh();
  }

  async function togglePreference(
    field: (typeof PREFERENCE_FIELDS)[number]['field'],
    key: (typeof PREFERENCE_FIELDS)[number]['key'],
    value: boolean,
  ) {
    setSaving(key);
    setPrefs((current) => (current ? { ...current, [key]: value } : current));

    const result = await updateNotificationPreferencesAction({ [field]: value });
    setSaving(null);

    if (!result.ok) {
      setPrefs((current) => (current ? { ...current, [key]: !value } : current));
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <Link
        href="/plus"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Plus
      </Link>

      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight">Notifications</h1>
        {unread.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={markAll}>
            <CheckCheck className="h-4 w-4" aria-hidden />
            Tout marquer lu
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<BellOff className="h-7 w-7" aria-hidden />}
          title="Aucune notification"
          description="Vous serez prévenu·e des tâches qui vous sont attribuées, des changements d'événements et des gardes à confirmer."
          className="surface"
        />
      ) : (
        <Card className="divide-y divide-[var(--line)] p-0">
          {items.map((notification) => {
            const Icon = ICONS[notification.kind] ?? Bell;
            const unreadItem = !notification.read_at;

            const body = (
              <>
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                    unreadItem
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-[var(--bg-subtle)] text-muted',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm',
                      unreadItem ? 'font-bold' : 'font-semibold text-muted',
                    )}
                  >
                    {notification.title}
                  </span>
                  {notification.body ? (
                    <span className="block truncate text-sm text-muted">
                      {notification.body}
                    </span>
                  ) : null}
                  <span className="block text-xs text-muted">
                    {formatRelativeDay(
                      notification.created_at.slice(0, 10),
                      household.timezone,
                    )}{' '}
                    à {formatTime(notification.created_at, household.timezone)}
                  </span>
                </span>
              </>
            );

            return (
              <div key={notification.id} className="flex items-center gap-1 pr-2">
                {notification.link ? (
                  <Link
                    href={notification.link}
                    onClick={() => markRead(notification)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                  >
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => markRead(notification)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    {body}
                  </button>
                )}
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => remove(notification.id)}
                  aria-label={`Supprimer la notification « ${notification.title} »`}
                >
                  <Trash2 className="h-4 w-4 text-muted" aria-hidden />
                </Button>
              </div>
            );
          })}
        </Card>
      )}

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Me prévenir quand…
        </h2>
        <Card className="divide-y divide-[var(--line)] p-0">
          {PREFERENCE_FIELDS.map(({ key, field, label }) => {
            // Sans ligne de préférences, tout est activé : le réglage est un
            // retrait, pas une adhésion.
            const checked = prefs ? prefs[key] : key !== 'tasks_completed';

            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-3 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={saving === key}
                  onChange={(e) => togglePreference(field, key, e.target.checked)}
                  className="h-4.5 w-4.5 shrink-0 accent-[var(--color-brand-500)]"
                />
                <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
              </label>
            );
          })}
        </Card>
        <p className="mt-2 px-1 text-xs text-muted">
          Ces réglages sont personnels : ils n'affectent pas l'autre adulte du foyer.
        </p>
      </section>
    </div>
  );
}
