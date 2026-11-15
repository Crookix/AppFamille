'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Baby,
  Check,
  ChevronRight,
  Plus,
  ShoppingBasket,
  UtensilsCrossed,
} from 'lucide-react';
import { Card, CardTitle, CheckCircle, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { SwipeRow } from '@/components/ui/swipe-row';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import { EventCard } from '@/components/calendar/event-card';
import { EventDetailSheet } from '@/components/events/event-detail-sheet';
import { QuickShoppingSheet } from '@/components/shopping/quick-shopping-sheet';
import { TaskSheet } from '@/components/tasks/task-sheet';
import { toggleTaskAction } from '@/lib/actions/tasks';
import { formatDayLong, formatRelativeDay, formatTime, todayIn } from '@/lib/datetime';
import { cn, formatDuration } from '@/lib/utils';
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
  /* Le temps d'un glissement (200 ms) la tâche cochée reste visible, cochée,
     avant de quitter la liste : le geste a un effet que l'œil suit. */
  const [leaving, setLeaving] = React.useState<string[]>([]);

  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  async function completeTask(taskId: string) {
    setLeaving((current) => [...current, taskId]);

    // L'écriture et le glissement partent ensemble : on n'attend que le plus long.
    const [result] = await Promise.all([
      toggleTaskAction(taskId, true),
      new Promise((resolve) => window.setTimeout(resolve, 200)),
    ]);

    if (!result.ok) {
      setLeaving((current) => current.filter((id) => id !== taskId));
      toast.error(result.error);
      return;
    }

    setOptimisticDone((current) => [...current, taskId]);
    setLeaving((current) => current.filter((id) => id !== taskId));

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
  const summary = buildSummary(data.todayEvents.length, pendingTasks.length, data.openItemCount);

  return (
    <div className="space-y-9">
      {/* --- Entête : le titre est le premier repère de l'écran ------------- */}
      <header className="reveal pt-1" style={stagger(0)}>
        <p className="text-[0.9375rem] font-semibold text-muted first-letter:uppercase">
          {formatDayLong(data.today)}
        </p>
        <h1 className="mt-1 text-balance text-[2.25rem] font-bold leading-[1.05] tracking-[-0.03em]">
          {greeting}, {me.display_name.split(' ')[0]}
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-snug text-muted">{summary}</p>
      </header>

      {/* --- Alerte : gardes à confirmer ---------------------------------- */}
      {data.childcareToConfirm > 0 ? (
        <Link
          href="/plus/nounous"
          className="reveal flex min-h-14 items-center gap-3 rounded-[var(--radius-xl2)] bg-[var(--notice-bg)] px-4 py-3 text-[var(--notice-fg)] transition-transform active:scale-[0.99]"
          style={stagger(1)}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug">
            {data.childcareToConfirm === 1
              ? 'Une garde attend la saisie de ses heures.'
              : `${data.childcareToConfirm} gardes attendent la saisie de leurs heures.`}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      ) : null}

      {/* --- Aujourd'hui -------------------------------------------------- */}
      <Section
        index={2}
        title="Aujourd'hui"
        action={<SectionLink href="/calendrier">Le calendrier</SectionLink>}
      >
        {data.todayEvents.length === 0 ? (
          <Card className="py-5">
            <p className="text-[1.0625rem] text-muted">Rien de prévu aujourd'hui. Profitez-en.</p>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {data.todayEvents.map((item) => (
              <EventCard key={item.key} item={item} onOpen={setSelectedEvent} />
            ))}
          </div>
        )}
      </Section>

      {/* --- Trajets des enfants ------------------------------------------ */}
      <TransportSummary events={data.todayEvents} index={3} />

      {/* --- Tâches -------------------------------------------------------- */}
      <Section
        index={4}
        title="À faire"
        action={<SectionLink href="/listes?onglet=taches">Tout voir</SectionLink>}
      >
        {pendingTasks.length === 0 ? (
          <Card className="py-3 pl-5 pr-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[1.0625rem] text-muted">Rien en attente. Bravo.</p>
              <Button variant="ghost" onClick={() => setAddingTask(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Ajouter
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            {pendingTasks.slice(0, 6).map((task, index) => {
              const assignee = members.find((m) => m.id === task.assignee_id);
              const late = task.due_date !== null && task.due_date < data.today;
              const leavingNow = leaving.includes(task.id);

              return (
                <SwipeRow
                  key={task.id}
                  onSwipeRight={{
                    label: 'Terminer',
                    icon: <Check className="h-5 w-5" aria-hidden />,
                    tone: 'ok',
                    onTrigger: () => completeTask(task.id),
                  }}
                >
                <div
                  className={cn(
                    'relative flex items-center gap-1 py-1 pl-2 pr-4',
                    'transition-[opacity,transform] duration-200 ease-out',
                    leavingNow && 'translate-x-3 opacity-0',
                    // Filet inséré sous la case, comme une liste groupée d'iOS.
                    index > 0 &&
                      'before:absolute before:left-14 before:right-0 before:top-0 before:h-px before:bg-[var(--line)]',
                  )}
                >
                  <CheckCircle
                    checked={leavingNow}
                    onChange={() => completeTask(task.id)}
                    label={`Marquer « ${task.title} » comme terminée`}
                  />
                  <div className="min-w-0 flex-1 py-2">
                    <p className="truncate text-[1.0625rem] font-semibold leading-tight">
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-muted">
                      {late ? (
                        <span className="font-bold text-[var(--alert-text)]">
                          En retard · {formatRelativeDay(task.due_date!, tz)}
                        </span>
                      ) : task.due_date ? (
                        formatRelativeDay(task.due_date, tz)
                      ) : (
                        'Sans date'
                      )}
                    </p>
                  </div>
                  {assignee ? (
                    <Avatar name={assignee.display_name} color={assignee.color} size="sm" />
                  ) : (
                    <span className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-bold text-muted">
                      libre
                    </span>
                  )}
                </div>
                </SwipeRow>
              );
            })}
          </Card>
        )}
      </Section>

      {/* --- Repas et courses --------------------------------------------- */}
      <div className="grid gap-9 sm:grid-cols-2 sm:gap-4">
        <Section index={5} title="Ce soir on mange">
          <Link href="/repas" className="block">
            <Card className="flex items-center gap-3.5 transition-transform active:scale-[0.99]">
              <IconTile tone="notice">
                <UtensilsCrossed className="h-5 w-5" aria-hidden />
              </IconTile>
              <div className="min-w-0 flex-1">
                {data.dinner ? (
                  <>
                    <CardTitle className="truncate text-[1.0625rem]">{data.dinner.title}</CardTitle>
                    {data.lunch ? (
                      <p className="mt-0.5 truncate text-[0.9375rem] text-muted">
                        Midi : {data.lunch.title}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[0.9375rem] leading-snug text-muted">
                    Rien de prévu. Touchez pour planifier la semaine.
                  </p>
                )}
              </div>
            </Card>
          </Link>
        </Section>

        <Section
          index={6}
          title="Courses"
          action={
            <button
              type="button"
              onClick={() => setAddingItem(true)}
              className="-my-2 inline-flex min-h-11 items-center px-1 text-[0.9375rem] font-semibold text-[var(--accent-text)] active:opacity-60"
            >
              Ajouter
            </button>
          }
        >
          <Link href="/listes?onglet=courses" className="block">
            <Card className="flex items-center gap-3.5 transition-transform active:scale-[0.99]">
              <IconTile tone="sage">
                <ShoppingBasket className="h-5 w-5" aria-hidden />
              </IconTile>
              <div className="min-w-0 flex-1">
                {data.openItemCount === 0 ? (
                  <p className="text-[0.9375rem] text-muted">La liste est vide.</p>
                ) : (
                  <>
                    <CardTitle className="text-[1.0625rem]">
                      {data.openItemCount} article{data.openItemCount > 1 ? 's' : ''} à acheter
                    </CardTitle>
                    <p className="mt-0.5 truncate text-[0.9375rem] text-muted">
                      {data.openItems.map((item) => item.label).join(' · ')}
                      {data.openItemCount > data.openItems.length ? '…' : ''}
                    </p>
                  </>
                )}
              </div>
            </Card>
          </Link>
        </Section>
      </div>

      {/* --- Prochaine garde ---------------------------------------------- */}
      <Section index={7} title="Prochaine garde">
        <Link href="/plus/nounous" className="block">
          <Card className="flex items-center gap-3.5 transition-transform active:scale-[0.99]">
            <IconTile tone="brand">
              <Baby className="h-5 w-5" aria-hidden />
            </IconTile>
            <div className="min-w-0 flex-1">
              {data.nextChildcare ? (
                <>
                  <CardTitle className="text-[1.0625rem]">
                    {nannyName ?? 'Garde'} ·{' '}
                    {formatRelativeDay(data.nextChildcare.scheduled_start.slice(0, 10), tz)}
                  </CardTitle>
                  <p className="mt-0.5 text-[0.9375rem] text-muted">
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
                <p className="text-[0.9375rem] text-muted">Aucune garde planifiée.</p>
              )}
            </div>
          </Card>
        </Link>
      </Section>

      {/* --- Prochainement ------------------------------------------------- */}
      {data.upcomingEvents.length > 0 ? (
        <Section index={8} title="Les jours suivants">
          <div className="space-y-3">
            {data.upcomingEvents.map((item) => (
              <div key={item.key}>
                <p className="mb-1.5 px-1 text-[0.8125rem] font-bold text-muted first-letter:uppercase">
                  {formatRelativeDay(item.startsAt.slice(0, 10), tz)}
                </p>
                <EventCard item={item} onOpen={setSelectedEvent} compact />
              </div>
            ))}
          </div>
        </Section>
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

/* -------------------------------------------------------------------------- */
/* Briques de l'écran                                                         */
/* -------------------------------------------------------------------------- */

/** Décale l'apparition d'un bloc : voir `.reveal` dans globals.css. */
function stagger(index: number): React.CSSProperties {
  return { '--i': index } as React.CSSProperties;
}

/**
 * Une section : un vrai titre (et non une étiquette en capitales), une action
 * d'accent à droite, et son apparition dans la cascade.
 */
function Section({
  index,
  title,
  action,
  children,
}: {
  index: number;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="reveal" style={stagger(index)}>
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[1.375rem] font-bold tracking-[-0.02em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      // Marge négative : la zone d'appui atteint 44 px sans écarter les titres.
      className="-my-2 inline-flex min-h-11 items-center px-1 text-[0.9375rem] font-semibold text-[var(--accent-text)] active:opacity-60"
    >
      {children}
    </Link>
  );
}

/**
 * Pastille d'icône, comme dans les Réglages d'iOS : un carré arrondi de
 * couleur pleine, un pictogramme blanc. La catégorie se reconnaît avant
 * d'être lue. Les trois fonds portent le blanc à 4,5:1 ou plus.
 */
function IconTile({
  tone,
  children,
}: {
  tone: 'brand' | 'sage' | 'notice';
  children: React.ReactNode;
}) {
  const background =
    tone === 'brand' ? 'bg-brand-500' : tone === 'sage' ? 'bg-sage-500' : 'bg-[#b85200]';

  return (
    <span
      aria-hidden
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.7rem] text-white',
        background,
      )}
    >
      {children}
    </span>
  );
}

/** « 2 événements, 3 tâches à faire et 8 articles à acheter. » */
function buildSummary(events: number, tasks: number, items: number): string {
  const parts: string[] = [];
  if (events > 0) parts.push(`${events} événement${events > 1 ? 's' : ''}`);
  if (tasks > 0) parts.push(`${tasks} tâche${tasks > 1 ? 's' : ''} à faire`);
  if (items > 0) parts.push(`${items} article${items > 1 ? 's' : ''} à acheter`);

  if (parts.length === 0) return 'Rien de prévu pour le moment.';
  if (parts.length === 1) return `Aujourd'hui : ${parts[0]}.`;
  return `Aujourd'hui : ${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}.`;
}

/**
 * Qui accompagne et qui récupère les enfants aujourd'hui.
 *
 * N'apparaît que si l'information existe : une carte vide « personne ne
 * conduit personne » n'apprend rien.
 */
function TransportSummary({ events, index }: { events: SerializedOccurrence[]; index: number }) {
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
    <Section index={index} title="Trajets des enfants">
      <Card className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="text-[0.9375rem]">
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
    </Section>
  );
}
