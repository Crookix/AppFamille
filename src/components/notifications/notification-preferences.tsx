'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { updateNotificationPreferencesAction } from '@/lib/actions/notifications';
import type { NotificationPreferenceRow } from '@/lib/database.types';

type Key =
  | 'tasks_assigned'
  | 'tasks_completed'
  | 'events_changed'
  | 'event_reminders'
  | 'childcare_to_confirm'
  | 'reco_added'
  | 'list_items_added'
  | 'google_sync_errors';

const FIELDS: { key: Key; field: string; label: string }[] = [
  { key: 'tasks_assigned', field: 'tasksAssigned', label: 'Une tâche m’est attribuée' },
  { key: 'tasks_completed', field: 'tasksCompleted', label: 'Une tâche est terminée par quelqu’un' },
  { key: 'events_changed', field: 'eventsChanged', label: 'Un événement est ajouté ou modifié' },
  { key: 'event_reminders', field: 'eventReminders', label: 'Rappels avant un événement' },
  { key: 'childcare_to_confirm', field: 'childcareToConfirm', label: 'Une garde attend ses heures' },
  { key: 'reco_added', field: 'recoAdded', label: 'Quelqu’un ajoute une reco' },
  {
    key: 'list_items_added',
    field: 'listItemsAdded',
    label: 'Quelqu’un ajoute à une liste (courses, tâches, check-lists)',
  },
  { key: 'google_sync_errors', field: 'googleSyncErrors', label: 'La synchronisation Google échoue' },
];

/**
 * Valeur d'un réglage quand la personne n'a jamais rien enregistré : tout est
 * activé sauf « tâche terminée ». Le réglage est un retrait, pas une adhésion.
 */
function defaultValue(key: Key) {
  return key !== 'tasks_completed';
}

/**
 * Les choix de notification de la personne connectée.
 *
 * Sans ligne en base, on part des valeurs par défaut : l'état local est
 * toujours complet, donc une case cochée ou décochée se voit tout de suite,
 * même la toute première fois.
 */
export function NotificationPreferences({
  preferences,
}: {
  preferences: NotificationPreferenceRow | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [values, setValues] = React.useState<Record<Key, boolean>>(() =>
    Object.fromEntries(
      FIELDS.map(({ key }) => [key, preferences ? preferences[key] : defaultValue(key)]),
    ) as Record<Key, boolean>,
  );
  const [saving, setSaving] = React.useState<Key | null>(null);

  async function toggle(key: Key, field: string, value: boolean) {
    setSaving(key);
    setValues((current) => ({ ...current, [key]: value }));

    const result = await updateNotificationPreferencesAction({ [field]: value });
    setSaving(null);

    if (!result.ok) {
      setValues((current) => ({ ...current, [key]: !value }));
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Card className="divide-y divide-[var(--line)] p-0">
        {FIELDS.map(({ key, field, label }) => (
          <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={values[key]}
              disabled={saving === key}
              onChange={(e) => toggle(key, field, e.target.checked)}
              className="h-4.5 w-4.5 shrink-0 accent-[var(--color-brand-500)]"
            />
            <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
          </label>
        ))}
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">
        Ces réglages sont personnels : ils n’affectent pas l’autre adulte du foyer.
      </p>
    </>
  );
}
