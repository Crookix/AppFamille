'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, Plus, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CheckCircle, EmptyState } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { Avatar } from '@/components/ui/avatar';
import { createClient } from '@/lib/supabase/client';
import { useHousehold } from '@/components/providers/household-provider';
import { TaskSheet } from '@/components/tasks/task-sheet';
import { deleteTaskAction, toggleTaskAction, updateTaskAction } from '@/lib/actions/tasks';
import { describeRecurrence } from '@/lib/recurrence';
import { cn } from '@/lib/utils';
import { formatRelativeDay, todayIn } from '@/lib/datetime';
import type { TaskRow } from '@/lib/database.types';

type Filter = 'mes_taches' | 'foyer' | 'aujourdhui' | 'retard' | 'libres';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'foyer', label: 'Tout le foyer' },
  { key: 'mes_taches', label: 'Mes tâches' },
  { key: 'aujourdhui', label: "Aujourd'hui" },
  { key: 'retard', label: 'En retard' },
  { key: 'libres', label: 'Sans responsable' },
];

export function TaskList({
  initialTasks,
  subtasks,
}: {
  initialTasks: TaskRow[];
  subtasks: TaskRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();
  const { household, members, children, me } = useHousehold();
  const today = todayIn(household.timezone);

  const [tasks, setTasks] = React.useState(initialTasks);
  const [filter, setFilter] = React.useState<Filter>('foyer');
  const [showDone, setShowDone] = React.useState(false);
  const [editing, setEditing] = React.useState<TaskRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [detail, setDetail] = React.useState<TaskRow | null>(null);

  React.useEffect(() => setTasks(initialTasks), [initialTasks]);

  React.useEffect(() => {
    const channel = supabase
      .channel(`taches-${household.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `household_id=eq.${household.id}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, household.id, router]);

  async function toggle(task: TaskRow) {
    const done = task.status !== 'termine';

    setTasks((current) =>
      current.map((t) =>
        t.id === task.id ? { ...t, status: done ? 'termine' : 'a_faire' } : t,
      ),
    );

    const result = await toggleTaskAction(task.id, done);

    if (!result.ok) {
      setTasks((current) =>
        current.map((t) =>
          t.id === task.id ? { ...t, status: done ? 'a_faire' : 'termine' } : t,
        ),
      );
      toast.error(result.error);
      return;
    }

    if (done) {
      toast.success(
        result.data?.recurring
          ? 'Fait — reprogrammée pour la prochaine fois.'
          : 'Tâche terminée.',
        {
          label: 'Annuler',
          onClick: async () => {
            await toggleTaskAction(task.id, false);
            router.refresh();
          },
        },
      );
    }
    router.refresh();
  }

  async function assignToMe(task: TaskRow) {
    const result = await updateTaskAction(task.id, { assigneeId: me.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Vous vous en occupez.');
    router.refresh();
  }

  const visible = tasks.filter((task) => {
    const done = task.status === 'termine';
    if (done !== showDone) return false;

    switch (filter) {
      case 'mes_taches':
        return task.assignee_id === me.id;
      case 'aujourdhui':
        return task.due_date === today;
      case 'retard':
        return Boolean(task.due_date && task.due_date < today);
      case 'libres':
        return task.assignee_id === null;
      default:
        return true;
    }
  });

  const counts = {
    retard: tasks.filter(
      (t) => t.status !== 'termine' && t.due_date && t.due_date < today,
    ).length,
    mes_taches: tasks.filter((t) => t.status !== 'termine' && t.assignee_id === me.id)
      .length,
  };

  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
              filter === f.key
                ? 'bg-brand-500 text-white'
                : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
            )}
          >
            {f.label}
            {f.key === 'retard' && counts.retard > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.65rem] font-bold',
                  filter === f.key ? 'bg-white/25' : 'bg-alert-100 text-alert-700',
                )}
              >
                {counts.retard}
              </span>
            ) : null}
            {f.key === 'mes_taches' && counts.mes_taches > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.65rem] font-bold',
                  filter === f.key ? 'bg-white/25' : 'bg-[var(--bg-elevated)]',
                )}
              >
                {counts.mes_taches}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Nouvelle tâche
        </Button>
        <Button
          variant={showDone ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? 'À faire' : 'Terminées'}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-7 w-7" aria-hidden />}
          title={showDone ? 'Rien de terminé' : 'Rien à faire'}
          description={
            showDone
              ? "Les tâches validées apparaîtront ici."
              : filter === 'foyer'
                ? 'Ajoutez ce qui doit être fait, et par qui.'
                : 'Aucune tâche ne correspond à ce filtre.'
          }
          className="surface"
        />
      ) : (
        <Card className="divide-y divide-[var(--line)] p-0">
          {visible.map((task) => {
            const assignee = members.find((m) => m.id === task.assignee_id);
            const child = children.find((c) => c.id === task.child_id);
            const late =
              task.status !== 'termine' && task.due_date && task.due_date < today;
            const taskSubtasks = subtasks.filter((s) => s.parent_task_id === task.id);
            const doneSubtasks = taskSubtasks.filter((s) => s.status === 'termine').length;

            return (
              <div key={task.id} className="flex items-center gap-1 py-0.5 pl-1 pr-2">
                <CheckCircle
                  checked={task.status === 'termine'}
                  onChange={() => toggle(task)}
                  label={`${task.status === 'termine' ? 'Rouvrir' : 'Terminer'} ${task.title}`}
                />

                <button
                  type="button"
                  onClick={() => setDetail(task)}
                  className="min-w-0 flex-1 py-2 text-left"
                >
                  <p
                    className={cn(
                      'truncate text-sm font-semibold',
                      task.status === 'termine' && 'text-muted line-through',
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                    {late ? (
                      <span className="font-bold text-alert-500">
                        En retard · {formatRelativeDay(task.due_date!, household.timezone)}
                      </span>
                    ) : task.due_date ? (
                      <span>{formatRelativeDay(task.due_date, household.timezone)}</span>
                    ) : null}
                    {task.priority === 'haute' ? (
                      <span className="font-bold text-brand-600">Priorité haute</span>
                    ) : null}
                    {task.recurrence_rule ? (
                      <span className="inline-flex items-center gap-1">
                        <Repeat className="h-3 w-3" aria-hidden />
                        {describeRecurrence(task.recurrence_rule)}
                      </span>
                    ) : null}
                    {child ? <span>{child.first_name}</span> : null}
                    {taskSubtasks.length > 0 ? (
                      <span>
                        {doneSubtasks}/{taskSubtasks.length} sous-tâches
                      </span>
                    ) : null}
                  </p>
                </button>

                {assignee ? (
                  <Avatar
                    name={assignee.display_name}
                    color={assignee.color}
                    size="sm"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => assignToMe(task)}
                    className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[0.65rem] font-bold text-muted transition-colors hover:text-[var(--fg)]"
                  >
                    Je m'en occupe
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <TaskSheet open={creating} onClose={() => setCreating(false)} />
      <TaskSheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        task={editing}
      />

      <TaskDetail
        task={detail}
        subtasks={detail ? subtasks.filter((s) => s.parent_task_id === detail.id) : []}
        onClose={() => setDetail(null)}
        onEdit={(task) => {
          setDetail(null);
          setEditing(task);
        }}
        onToggleSubtask={toggle}
        onDeleted={() => {
          setDetail(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function TaskDetail({
  task,
  subtasks,
  onClose,
  onEdit,
  onToggleSubtask,
  onDeleted,
}: {
  task: TaskRow | null;
  subtasks: TaskRow[];
  onClose: () => void;
  onEdit: (task: TaskRow) => void;
  onToggleSubtask: (task: TaskRow) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const { members, children, household } = useHousehold();
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  if (!task) return null;

  const assignee = members.find((m) => m.id === task.assignee_id);
  const child = children.find((c) => c.id === task.child_id);

  async function remove() {
    setDeleting(true);
    const result = await deleteTaskAction(task!.id);
    setDeleting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Tâche supprimée.');
    setConfirming(false);
    onDeleted();
  }

  return (
    <Sheet
      open={Boolean(task)}
      onClose={onClose}
      title={task.title}
      footer={
        confirming ? (
          <div className="pb-1">
            <p className="mb-3 text-sm text-muted">
              Cette tâche sera définitivement supprimée.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Annuler
              </Button>
              <Button variant="danger" className="flex-1" onClick={remove} loading={deleting}>
                Supprimer
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pb-1">
            <Button variant="outline" className="flex-1" onClick={() => setConfirming(true)}>
              Supprimer
            </Button>
            <Button className="flex-1" onClick={() => onEdit(task)}>
              Modifier
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={task.status === 'termine' ? 'sage' : 'neutral'}>
            {task.status === 'termine'
              ? 'Terminée'
              : task.status === 'en_cours'
                ? 'En cours'
                : 'À faire'}
          </Badge>
          {task.priority !== 'normale' ? (
            <Badge tone={task.priority === 'haute' ? 'brand' : 'neutral'}>
              Priorité {task.priority}
            </Badge>
          ) : null}
          {task.recurrence_rule ? (
            <Badge>
              <Repeat className="h-3 w-3" aria-hidden />
              {describeRecurrence(task.recurrence_rule)}
            </Badge>
          ) : null}
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="w-28 shrink-0 text-muted">Responsable</dt>
            <dd className="flex items-center gap-2 font-semibold">
              {assignee ? (
                <>
                  <Avatar
                    name={assignee.display_name}
                    color={assignee.color}
                    size="xs"
                  />
                  {assignee.display_name}
                </>
              ) : (
                <span className="font-normal text-muted">Personne pour l'instant</span>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-28 shrink-0 text-muted">Échéance</dt>
            <dd className="font-semibold">
              {task.due_date
                ? formatRelativeDay(task.due_date, household.timezone)
                : <span className="font-normal text-muted">Sans date</span>}
            </dd>
          </div>
          {child ? (
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-muted">Enfant</dt>
              <dd className="flex items-center gap-2 font-semibold">
                <Avatar name={child.first_name} color={child.color} size="xs" />
                {child.first_name}
              </dd>
            </div>
          ) : null}
        </dl>

        {task.description ? (
          <div>
            <p className="mb-1 text-sm font-semibold">Notes</p>
            <p className="whitespace-pre-wrap text-sm text-muted">{task.description}</p>
          </div>
        ) : null}

        {subtasks.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-semibold">Sous-tâches</p>
            <div className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
              {subtasks.map((subtask) => (
                <div key={subtask.id} className="flex items-center gap-1 pl-1 pr-3">
                  <CheckCircle
                    checked={subtask.status === 'termine'}
                    onChange={() => onToggleSubtask(subtask)}
                    label={`Terminer ${subtask.title}`}
                  />
                  <span
                    className={cn(
                      'flex-1 py-2 text-sm',
                      subtask.status === 'termine' && 'text-muted line-through',
                    )}
                  >
                    {subtask.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
