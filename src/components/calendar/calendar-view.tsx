'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { useHousehold } from '@/components/providers/household-provider';
import { EventCard } from '@/components/calendar/event-card';
import { EventDetailSheet } from '@/components/events/event-detail-sheet';
import { EventSheet } from '@/components/events/event-sheet';
import { CATEGORY_META, type CategoryKey } from '@/components/events/pickers';
import { cn, colorHex } from '@/lib/utils';
import {
  addDays,
  dayKey,
  formatDayLong,
  formatMonthLong,
  formatRelativeDay,
  formatTime,
  startOfMonth,
  startOfWeek,
  todayIn,
} from '@/lib/datetime';
import type { SerializedOccurrence } from '@/lib/data/calendar';

export type CalendarMode = 'agenda' | 'jour' | 'semaine' | 'mois';

const MODES: { key: CalendarMode; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'jour', label: 'Jour' },
  { key: 'semaine', label: 'Semaine' },
  { key: 'mois', label: 'Mois' },
];

export function CalendarView({
  occurrences,
  mode,
  anchorDay,
  attachmentEventIds,
}: {
  occurrences: SerializedOccurrence[];
  mode: CalendarMode;
  anchorDay: string;
  attachmentEventIds: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { household, members, children } = useHousehold();
  const tz = household.timezone;
  const today = todayIn(tz);

  const [selected, setSelected] = React.useState<SerializedOccurrence | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [creatingOn, setCreatingOn] = React.useState<string | null>(null);

  const [memberFilter, setMemberFilter] = React.useState<string[]>([]);
  const [childFilter, setChildFilter] = React.useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryKey[]>([]);

  const withAttachments = React.useMemo(
    () => new Set(attachmentEventIds),
    [attachmentEventIds],
  );

  const filterCount =
    memberFilter.length + childFilter.length + categoryFilter.length;

  const visible = React.useMemo(() => {
    if (filterCount === 0) return occurrences;

    return occurrences.filter((item) => {
      if (
        categoryFilter.length > 0 &&
        !categoryFilter.includes(item.event.category as CategoryKey)
      ) {
        return false;
      }
      if (
        memberFilter.length > 0 &&
        !item.memberIds.some((id) => memberFilter.includes(id)) &&
        !memberFilter.includes(item.event.responsible_member_id ?? '')
      ) {
        return false;
      }
      if (
        childFilter.length > 0 &&
        !item.childIds.some((id) => childFilter.includes(id))
      ) {
        return false;
      }
      return true;
    });
  }, [occurrences, memberFilter, childFilter, categoryFilter, filterCount]);

  /** Occurrences regroupées par jour civil, dans le fuseau du foyer. */
  const byDay = React.useMemo(() => {
    const map = new Map<string, SerializedOccurrence[]>();
    for (const item of visible) {
      const key = dayKey(item.startsAt, tz);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [visible, tz]);

  function navigate(nextDay: string, nextMode: CalendarMode = mode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('vue', nextMode);
    params.set('date', nextDay);
    router.push(`/calendrier?${params.toString()}`);
  }

  function shift(direction: 1 | -1) {
    const amount =
      mode === 'jour' ? 1 : mode === 'semaine' ? 7 : mode === 'mois' ? 0 : 14;

    if (mode === 'mois') {
      const [y, m] = anchorDay.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1 + direction, 1));
      navigate(next.toISOString().slice(0, 10));
      return;
    }
    navigate(addDays(anchorDay, amount * direction));
  }

  const periodLabel =
    mode === 'mois'
      ? formatMonthLong(anchorDay)
      : mode === 'semaine'
        ? `Semaine du ${formatDayLong(startOfWeek(anchorDay))}`
        : mode === 'jour'
          ? formatRelativeDay(anchorDay, tz)
          : 'Prochainement';

  return (
    <div>
      {/* --- Entête ------------------------------------------------------- */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="truncate text-xl font-extrabold tracking-tight first-letter:uppercase">
          {periodLabel}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => shift(-1)}
            aria-label="Période précédente"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(today)}>
            Aujourd'hui
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => shift(1)}
            aria-label="Période suivante"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </div>

      {/* --- Vues et filtres ---------------------------------------------- */}
      <div className="mb-4 flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Type de vue"
          className="no-scrollbar flex flex-1 gap-1 overflow-x-auto rounded-full bg-[var(--bg-subtle)] p-1"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => navigate(anchorDay, m.key)}
              className={cn(
                'h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold transition-colors',
                mode === m.key
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--fg-muted)]',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <Button
          variant={filterCount > 0 ? 'primary' : 'outline'}
          size="iconSm"
          onClick={() => setFiltersOpen(true)}
          aria-label={`Filtres${filterCount > 0 ? ` (${filterCount} actifs)` : ''}`}
          className="relative shrink-0"
        >
          <Filter className="h-4 w-4" aria-hidden />
          {filterCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--fg)] text-[0.6rem] font-bold text-[var(--bg-elevated)]">
              {filterCount}
            </span>
          ) : null}
        </Button>
      </div>

      {filterCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Filtré sur :</span>
          {memberFilter.map((id) => {
            const member = members.find((m) => m.id === id);
            return member ? (
              <Badge key={id} tone="brand">
                {member.display_name}
              </Badge>
            ) : null;
          })}
          {childFilter.map((id) => {
            const child = children.find((c) => c.id === id);
            return child ? (
              <Badge key={id} tone="sage">
                {child.first_name}
              </Badge>
            ) : null;
          })}
          {categoryFilter.map((key) => (
            <Badge key={key}>{CATEGORY_META[key].label}</Badge>
          ))}
          <button
            type="button"
            onClick={() => {
              setMemberFilter([]);
              setChildFilter([]);
              setCategoryFilter([]);
            }}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-brand-600 underline underline-offset-2"
          >
            <X className="h-3 w-3" aria-hidden />
            Tout effacer
          </button>
        </div>
      ) : null}

      {/* --- Contenu ------------------------------------------------------ */}
      {mode === 'mois' ? (
        <MonthGrid
          anchorDay={anchorDay}
          byDay={byDay}
          today={today}
          onPickDay={(day) => navigate(day, 'jour')}
        />
      ) : mode === 'semaine' ? (
        <WeekList
          anchorDay={anchorDay}
          byDay={byDay}
          today={today}
          onOpen={setSelected}
          onAdd={setCreatingOn}
          withAttachments={withAttachments}
        />
      ) : mode === 'jour' ? (
        <DayList
          day={anchorDay}
          items={byDay.get(anchorDay) ?? []}
          onOpen={setSelected}
          onAdd={setCreatingOn}
          withAttachments={withAttachments}
          tz={tz}
        />
      ) : (
        <AgendaList
          byDay={byDay}
          today={today}
          onOpen={setSelected}
          withAttachments={withAttachments}
          hasFilters={filterCount > 0}
        />
      )}

      {/* --- Feuilles ----------------------------------------------------- */}
      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtrer">
        <div className="space-y-5">
          <FilterGroup
            title="Adultes"
            options={members.map((m) => ({
              id: m.id,
              label: m.display_name,
              color: m.color,
            }))}
            selected={memberFilter}
            onToggle={(id) =>
              setMemberFilter((current) =>
                current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
              )
            }
          />

          {children.length > 0 ? (
            <FilterGroup
              title="Enfants"
              options={children.map((c) => ({
                id: c.id,
                label: c.first_name,
                color: c.color,
              }))}
              selected={childFilter}
              onToggle={(id) =>
                setChildFilter((current) =>
                  current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
                )
              }
            />
          ) : null}

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Catégories</legend>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CATEGORY_META) as CategoryKey[]).map((key) => {
                const selectedCategory = categoryFilter.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    role="checkbox"
                    aria-checked={selectedCategory}
                    onClick={() =>
                      setCategoryFilter((current) =>
                        current.includes(key)
                          ? current.filter((x) => x !== key)
                          : [...current, key],
                      )
                    }
                    className={cn(
                      'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
                      selectedCategory
                        ? 'text-white'
                        : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
                    )}
                    style={
                      selectedCategory
                        ? { backgroundColor: CATEGORY_META[key].color }
                        : undefined
                    }
                  >
                    {CATEGORY_META[key].label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Sheet>

      <EventDetailSheet
        item={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />

      <EventSheet
        open={Boolean(creatingOn)}
        onClose={() => setCreatingOn(null)}
        defaultDay={creatingOn ?? undefined}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vues                                                                       */
/* -------------------------------------------------------------------------- */

function AgendaList({
  byDay,
  today,
  onOpen,
  withAttachments,
  hasFilters,
}: {
  byDay: Map<string, SerializedOccurrence[]>;
  today: string;
  onOpen: (item: SerializedOccurrence) => void;
  withAttachments: Set<string>;
  hasFilters: boolean;
}) {
  const days = [...byDay.keys()].sort();

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-7 w-7" aria-hidden />}
        title={hasFilters ? 'Rien avec ces filtres' : 'Rien de prévu'}
        description={
          hasFilters
            ? "Essayez d'élargir les filtres pour voir davantage d'événements."
            : "Les prochains rendez-vous du foyer s'afficheront ici."
        }
        className="surface"
      />
    );
  }

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <section key={day}>
          <h2
            className={cn(
              'mb-2 px-1 text-sm font-bold first-letter:uppercase',
              day === today ? 'text-brand-600' : 'text-muted',
            )}
          >
            {formatRelativeDay(day)}
          </h2>
          <div className="space-y-2">
            {byDay.get(day)!.map((item) => (
              <EventCard
                key={item.key}
                item={item}
                onOpen={onOpen}
                hasAttachments={withAttachments.has(item.event.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DayList({
  day,
  items,
  onOpen,
  onAdd,
  withAttachments,
  tz,
}: {
  day: string;
  items: SerializedOccurrence[];
  onOpen: (item: SerializedOccurrence) => void;
  onAdd: (day: string) => void;
  withAttachments: Set<string>;
  tz: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-7 w-7" aria-hidden />}
        title="Journée libre"
        description="Aucun événement ce jour-là."
        className="surface"
        action={
          <Button variant="outline" onClick={() => onAdd(day)}>
            <Plus className="h-4 w-4" aria-hidden />
            Ajouter un événement
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex gap-3">
          <span className="w-12 shrink-0 pt-3.5 text-right text-xs font-bold text-muted">
            {item.event.all_day ? 'Jour' : formatTime(item.startsAt, tz)}
          </span>
          <div className="min-w-0 flex-1">
            <EventCard
              item={item}
              onOpen={onOpen}
              hasAttachments={withAttachments.has(item.event.id)}
            />
          </div>
        </div>
      ))}
      <Button variant="ghost" className="w-full" onClick={() => onAdd(day)}>
        <Plus className="h-4 w-4" aria-hidden />
        Ajouter à cette journée
      </Button>
    </div>
  );
}

function WeekList({
  anchorDay,
  byDay,
  today,
  onOpen,
  onAdd,
  withAttachments,
}: {
  anchorDay: string;
  byDay: Map<string, SerializedOccurrence[]>;
  today: string;
  onOpen: (item: SerializedOccurrence) => void;
  onAdd: (day: string) => void;
  withAttachments: Set<string>;
}) {
  const start = startOfWeek(anchorDay);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const items = byDay.get(day) ?? [];
        return (
          <section key={day}>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2
                className={cn(
                  'text-sm font-bold first-letter:uppercase',
                  day === today ? 'text-brand-600' : 'text-muted',
                )}
              >
                {formatDayLong(day, { withYear: false })}
              </h2>
              <button
                type="button"
                onClick={() => onAdd(day)}
                aria-label={`Ajouter un événement le ${formatDayLong(day)}`}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {items.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--line)] px-3.5 py-2.5 text-sm text-muted">
                Rien de prévu
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <EventCard
                    key={item.key}
                    item={item}
                    onOpen={onOpen}
                    compact
                    hasAttachments={withAttachments.has(item.event.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({
  anchorDay,
  byDay,
  today,
  onPickDay,
}: {
  anchorDay: string;
  byDay: Map<string, SerializedOccurrence[]>;
  today: string;
  onPickDay: (day: string) => void;
}) {
  const first = startOfMonth(anchorDay);
  const gridStart = startOfWeek(first);
  const month = first.slice(0, 7);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="surface rounded-[var(--radius-xl2)] p-2">
      <div className="grid grid-cols-7 gap-1 pb-1">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, i) => (
          <span
            key={i}
            className="py-1 text-center text-[0.7rem] font-bold uppercase text-muted"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day) => {
          const items = byDay.get(day) ?? [];
          const inMonth = day.startsWith(month);
          const isToday = day === today;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              aria-label={`${formatDayLong(day)}, ${items.length} événement${items.length > 1 ? 's' : ''}`}
              className={cn(
                'flex aspect-square flex-col items-center justify-start gap-1 rounded-xl p-1 transition-colors',
                inMonth ? 'hover:bg-[var(--bg-subtle)]' : 'opacity-35',
                isToday && 'bg-brand-100',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  isToday && 'bg-brand-500 text-white',
                )}
              >
                {Number(day.slice(-2))}
              </span>
              <span className="flex max-w-full flex-wrap items-center justify-center gap-0.5">
                {items.slice(0, 4).map((item) => (
                  <span
                    key={item.key}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        (CATEGORY_META[item.event.category as CategoryKey] ??
                          CATEGORY_META.famille).color,
                    }}
                    aria-hidden
                  />
                ))}
                {items.length > 4 ? (
                  <span className="text-[0.6rem] font-bold text-muted" aria-hidden>
                    +
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { id: string; label: string; color: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => onToggle(option.id)}
              className={cn(
                'flex h-10 items-center gap-2 rounded-full border-2 pl-1 pr-3.5 text-sm font-semibold transition-colors',
                isSelected
                  ? 'border-transparent text-white'
                  : 'border-[var(--line)] text-[var(--fg)]',
              )}
              style={isSelected ? { backgroundColor: colorHex(option.color) } : undefined}
            >
              <Avatar name={option.label} color={option.color} size="sm" />
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
