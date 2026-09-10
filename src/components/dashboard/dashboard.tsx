'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Baby,
  CalendarDays,
  ChevronRight,
  ListChecks,
  Plus,
  ShoppingBasket,
  UtensilsCrossed,
} from 'lucide-react';
import { Card, CardTitle, CheckCircle, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { EventCard } from '@/components/calendar/event-card';
import { EventDetailSheet } from '@/components/events/event-detail-sheet';
import { QuickShoppingSheet } from '@/components/shopping/quick-shopping-sheet';
import { TaskSheet } from '@/components/tasks/task-sheet';
import { toggleTaskAction } from '@/lib/actions/tasks';
import { formatDayLong, formatRelativeDay, formatTime, todayIn } from '@/lib/datetime';
import { formatDuration } from '@/lib/utils';
import { scheduledMinutes } from '@/lib/childcare';
import type { DashboardData } from '@/lib/data/dashboard';
import type { SerializedOccurrence } from '@/lib/data/calendar';

export function Dashboard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const toast = useToast();
  const { household, members, children, me } = useHousehold();
  const tz = household.timezone;

  const [selectedEvent, setSelectedEvent] = React.useState<SerializedOccurrence | null>(null);
  const [addingItem, setAddingItem] = React.useState(false);
  const [addingTask, setAddingTask] = React.useState(false);
  /* Les tâches cochées disparaissent immédiatement, sans attendre le serveur :
     cocher une tâche doit répondre au doigt. */
  const [optimisticDone, setOptimisticDone] = React.useState<string[]>([]);

  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  async function completeTask(taskId: string) {
    setOptimisticDone((current) => [...current, taskId]);

    const result = await toggleTaskAction(taskId, true);

    if (!result.ok) {
      setOptimisticDone((current) => current.filter((id) => id !== taskId));
      toast.error(result.error);
      return;
    }

    toast.success(
      result.data?.recurring ? 'Fait — reprogrammée pour la prochaine fois.' : 'Tâche terminée.',
      {
        label: 'Annuler',
        onClick: async () => {
          await toggleTaskAction(taskId, false);
          setOptimisticDone((current) => current.filter((id) => id !== taskId));
          router.refresh();
        },
      },
    );
    router.refresh();
  }

  const pendingTasks = [...data.overdueTasks, ...data.todayTasks].filter(
    (task) => !optimisticDone.includes(task.id),
  );

  const nannyName = data.nextChildcare?.nanny?.name ?? null;

  return (
    <div className="space-y-6">
      {/* --- Entête ------------------------------------------------------- */}
      <header>
        <p className="text-sm text-muted first-letter:uppercase">
          {formatDayLong(data.today)}
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {greeting}, {me.display_name.split(' ')[0]}
        </h1>
      </header>

      {/* --- Alerte : gardes à confirmer ---------------------------------- */}
      {data.childcareToConfirm > 0 ? (
        <Link
          href="/plus/nounous"
          className="flex items-center gap-3 rounded-[var(--radius-xl2)] bg-honey-100 p-3.5 text-honey-700 transition-colors hover:bg-honey-300/50"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-semibold">
            {data.childcareToConfirm === 1
              ? 'Une garde attend la saisie de ses heures.'
              : `${data.childcareToConfirm} gardes attendent la saisie de leurs heures.`}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      ) : null}

      {/* --- Aujourd'hui -------------------------------------------------- */}
      <section>
        <SectionHeader
          title="Aujourd'hui"
          icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
          action={
            <Link
              href="/calendrier"
              className="text-xs font-bold text-brand-600 underline underline-offset-2"
            >
              Le calendrier
            </Link>
          }
        />

        {data.todayEvents.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Rien de prévu aujourd'hui. Profitez-en.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.todayEvents.map((item) => (
              <EventCard key={item.key} item={item} onOpen={setSelectedEvent} />
            ))}
          </div>
        )}
      </section>

      {/* --- Trajets des enfants ------------------------------------------ */}
      <TransportSummary events={data.todayEvents} />

      {/* --- Tâches -------------------------------------------------------- */}
      <section>
        <SectionHeader
          title="À faire"
          icon={<ListChecks className="h-3.5 w-3.5" aria-hidden />}
          action={
            <Link
              href="/listes?onglet=taches"
              className="text-xs font-bold text-brand-600 underline underline-offset-2"
            >
              Tout voir
            </Link>
          }
        />

        {pendingTasks.length === 0 ? (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">Rien en attente. Bravo.</p>
              <Button variant="ghost" size="sm" onClick={() => setAddingTask(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Ajouter
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="divide-y divide-[var(--line)] p-0">
            {pendingTasks.slice(0, 6).map((task) => {
              const assignee = members.find((m) => m.id === task.assignee_id);
              const late = task.due_date !== null && task.due_date < data.today;

              return (
                <div key={task.id} className="flex items-center gap-1 py-1 pl-1 pr-3">
                  <CheckCircle
                    checked={false}
                    onChange={() => completeTask(task.id)}
                    label={`Marquer « ${task.title} » comme terminée`}
                  />
                  <div className="min-w-0 flex-1 py-1.5">
                    <p className="truncate text-sm font-semibold">{task.title}</p>
                    <p className="flex items-center gap-2 text-xs text-muted">
                      {late ? (
                        <span className="font-bold text-alert-500">
                          En retard · {formatRelativeDay(task.due_date!, tz)}
                        </span>
                      ) : task.due_date ? (
                        <span>{formatRelativeDay(task.due_date, tz)}</span>
                      ) : (
                        <span>Sans date</span>
                      )}
                    </p>
                  </div>
                  {assignee ? (
                    <Avatar
                      name={assignee.display_name}
                      color={assignee.color}
                      size="sm"
                    />
                  ) : (
                    <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[0.65rem] font-bold text-muted">
                      libre
                    </span>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {/* --- Repas et courses --------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <SectionHeader
            title="Ce soir on mange"
            icon={<UtensilsCrossed className="h-3.5 w-3.5" aria-hidden />}
          />
          <Link href="/repas" className="block">
            <Card className="transition-transform active:scale-[0.99]">
              {data.dinner ? (
                <>
                  <CardTitle>{data.dinner.title}</CardTitle>
                  {data.lunch ? (
                    <p className="mt-1 text-sm text-muted">
                      Midi : {data.lunch.title}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">
                  Rien de prévu. Touchez pour planifier la semaine.
                </p>
              )}
            </Card>
          </Link>
        </section>

        <section>
          <SectionHeader
            title="Courses"
            icon={<ShoppingBasket className="h-3.5 w-3.5" aria-hidden />}
            action={
              <button
                type="button"
                onClick={() => setAddingItem(true)}
                className="text-xs font-bold text-brand-600 underline underline-offset-2"
              >
                Ajouter
              </button>
            }
          />
          <Link href="/listes?onglet=courses" className="block">
            <Card className="transition-transform active:scale-[0.99]">
              {data.openItemCount === 0 ? (
                <p className="text-sm text-muted">La liste est vide.</p>
              ) : (
                <>
                  <CardTitle>
                    {data.openItemCount} article{data.openItemCount > 1 ? 's' : ''} à acheter
                  </CardTitle>
                  <p className="mt-1 truncate text-sm text-muted">
                    {data.openItems.map((item) => item.label).join(' · ')}
                    {data.openItemCount > data.openItems.length ? '…' : ''}
                  </p>
                </>
              )}
            </Card>
          </Link>
        </section>
      </div>

      {/* --- Prochaine garde ---------------------------------------------- */}
      <section>
        <SectionHeader
          title="Prochaine garde"
          icon={<Baby className="h-3.5 w-3.5" aria-hidden />}
        />
        <Link href="/plus/nounous" className="block">
          <Card className="transition-transform active:scale-[0.99]">
            {data.nextChildcare ? (
              <>
                <CardTitle>
                  {nannyName ?? 'Garde'} ·{' '}
                  {formatRelativeDay(data.nextChildcare.scheduled_start.slice(0, 10), tz)}
                </CardTitle>
                <p className="mt-1 text-sm text-muted">
                  {formatTime(data.nextChildcare.scheduled_start, tz)} –{' '}
                  {formatTime(data.nextChildcare.scheduled_end, tz)} ·{' '}
                  {formatDuration(
                    scheduledMinutes(
                      data.nextChildcare.scheduled_start,
                      data.nextChildcare.scheduled_end,
                    ),
                  )}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Aucune garde planifiée.</p>
            )}
          </Card>
        </Link>
      </section>

      {/* --- Prochainement ------------------------------------------------- */}
      {data.upcomingEvents.length > 0 ? (
        <section>
          <SectionHeader title="Les jours suivants" />
          <div className="space-y-2">
            {data.upcomingEvents.map((item) => (
              <div key={item.key}>
                <p className="mb-1 px-1 text-xs font-bold text-muted first-letter:uppercase">
                  {formatRelativeDay(item.startsAt.slice(0, 10), tz)}
                </p>
                <EventCard item={item} onOpen={setSelectedEvent} compact />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {children.length === 0 ? (
        <EmptyState
          title="Ajoutez vos enfants"
          description="Vous pourrez les associer aux événements, aux repas et aux gardes."
          action={
            <Link
              href="/plus/enfants"
              className="inline-flex h-11 items-center rounded-full bg-brand-500 px-5 font-semibold text-white"
            >
              Ajouter un enfant
            </Link>
          }
          className="surface"
        />
      ) : null}

      <EventDetailSheet
        item={selectedEvent}
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
      />
      <QuickShoppingSheet
        open={addingItem}
        onClose={() => setAddingItem(false)}
        listId={data.defaultList?.id ?? null}
      />
      <TaskSheet
        open={addingTask}
        onClose={() => setAddingTask(false)}
        defaultDueDate={todayIn(tz)}
      />
    </div>
  );
}

/**
 * Qui accompagne et qui récupère les enfants aujourd'hui.
 *
 * N'apparaît que si l'information existe : une carte vide « personne ne
 * conduit personne » n'apprend rien.
 */
function TransportSummary({ events }: { events: SerializedOccurrence[] }) {
  const { members, children } = useHousehold();

  const rows = events
    .filter((item) => item.event.dropoff_member_id || item.event.pickup_member_id)
    .map((item) => ({
      key: item.key,
      title: item.event.title,
      childNames: item.childIds
        .map((id) => children.find((c) => c.id === id)?.first_name)
        .filter(Boolean)
        .join(', '),
      dropoff: members.find((m) => m.id === item.event.dropoff_member_id) ?? null,
      pickup: members.find((m) => m.id === item.event.pickup_member_id) ?? null,
    }));

  if (rows.length === 0) return null;

  return (
    <section>
      <SectionHeader title="Trajets des enfants" />
      <Card className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.key} className="text-sm">
            <p className="font-semibold">
              {row.title}
              {row.childNames ? (
                <span className="font-normal text-muted"> · {row.childNames}</span>
              ) : null}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              {row.dropoff ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar
                    name={row.dropoff.display_name}
                    color={row.dropoff.color}
                    size="xs"
                  />
                  accompagne
                </span>
              ) : null}
              {row.pickup ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={row.pickup.display_name} color={row.pickup.color} size="xs" />
                  récupère
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </Card>
    </section>
  );
}
