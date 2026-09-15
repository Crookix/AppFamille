'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { CATEGORY_META, type CategoryKey } from '@/components/events/pickers';
import { daySegment, fillsWholeDay } from '@/lib/calendar-layout';
import { addDays, formatDayLong, formatTime, startOfMonth, startOfWeek } from '@/lib/datetime';
import type { SerializedOccurrence } from '@/lib/data/calendar';

/** Nombre d'événements montrés dans une case avant le « +n ». */
const MAX_PER_CELL = 3;

type Entry = {
  item: SerializedOccurrence;
  allDay: boolean;
  startMin: number;
};

/**
 * Vue mois : une grille de six semaines où chaque événement porte son titre.
 *
 * Elle affichait auparavant des pastilles de couleur, qui disent « il se passe
 * quelque chose » sans dire quoi — il fallait ouvrir chaque journée pour
 * savoir. Un mois sert à repérer une date : le titre doit y être.
 */
export function MonthGrid({
  anchorDay,
  occurrences,
  tz,
  today,
  onOpen,
  onPickDay,
}: {
  anchorDay: string;
  occurrences: SerializedOccurrence[];
  tz: string;
  today: string;
  onOpen: (item: SerializedOccurrence) => void;
  onPickDay: (day: string) => void;
}) {
  const first = startOfMonth(anchorDay);
  const gridStart = startOfWeek(first);
  const month = first.slice(0, 7);
  const cells = React.useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  );

  /* Les journées entières d'abord, puis l'ordre des horaires : c'est celui
     dans lequel la journée se déroule. */
  const byDay = React.useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const day of cells) {
      const entries: Entry[] = [];
      for (const item of occurrences) {
        const segment = daySegment(item.startsAt, item.endsAt, day, tz);
        if (!segment) continue;
        entries.push({
          item,
          allDay: item.event.all_day || fillsWholeDay(segment),
          startMin: segment.startMin,
        });
      }
      entries.sort(
        (a, b) => Number(b.allDay) - Number(a.allDay) || a.startMin - b.startMin,
      );
      map.set(day, entries);
    }
    return map;
  }, [cells, occurrences, tz]);

  return (
    <div className="surface overflow-hidden rounded-[var(--radius-xl2)]">
      <div className="grid grid-cols-7 border-b border-[var(--line)]">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((label) => (
          <span
            key={label}
            className="py-1.5 text-center text-[0.65rem] font-bold uppercase text-muted"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, index) => {
          const entries = byDay.get(day) ?? [];
          const inMonth = day.startsWith(month);
          const isToday = day === today;

          return (
            <div
              key={day}
              className={cn(
                'relative flex min-h-[5rem] flex-col gap-0.5 border-[var(--line)] p-0.5 sm:min-h-[7rem] sm:p-1',
                index % 7 !== 0 && 'border-l',
                index >= 7 && 'border-t',
                !inMonth && 'bg-[var(--bg-subtle)]/40',
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                aria-label={`${formatDayLong(day)}, ${entries.length} événement${entries.length > 1 ? 's' : ''}`}
                className="mx-auto flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold tabular-nums transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span
                  className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full px-1',
                    isToday && 'bg-brand-500 text-white',
                    !inMonth && !isToday && 'text-muted',
                  )}
                >
                  {Number(day.slice(-2))}
                </span>
              </button>

              {entries.slice(0, MAX_PER_CELL).map(({ item, allDay }) => (
                <MonthChip
                  key={item.key}
                  item={item}
                  allDay={allDay}
                  tz={tz}
                  onOpen={onOpen}
                />
              ))}

              {entries.length > MAX_PER_CELL ? (
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="px-0.5 text-left text-[0.6rem] font-bold text-muted hover:text-[var(--fg)]"
                >
                  +{entries.length - MAX_PER_CELL} autre
                  {entries.length - MAX_PER_CELL > 1 ? 's' : ''}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthChip({
  item,
  allDay,
  tz,
  onOpen,
}: {
  item: SerializedOccurrence;
  allDay: boolean;
  tz: string;
  onOpen: (item: SerializedOccurrence) => void;
}) {
  const color =
    (CATEGORY_META[item.event.category as CategoryKey] ?? CATEGORY_META.famille).color;
  const title = item.event.is_busy_only ? 'Occupé' : item.event.title;

  /* Une journée entière se lit comme un bandeau plein ; un rendez-vous comme
     une ligne précédée de sa pastille, l'heure à côté quand la place le
     permet. C'est la distinction que fait tout agenda. */
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={`${allDay ? 'Journée entière' : formatTime(item.startsAt, tz)} · ${title}`}
      className={cn(
        'flex w-full items-center gap-1 overflow-hidden rounded px-1 py-px text-left text-[0.6rem] font-semibold leading-tight sm:text-[0.7rem]',
        allDay ? 'text-white' : 'hover:bg-[var(--bg-subtle)]',
      )}
      style={allDay ? { backgroundColor: color } : undefined}
    >
      {allDay ? null : (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {!allDay ? (
        <span className="hidden shrink-0 text-muted tabular-nums sm:inline">
          {formatTime(item.startsAt, tz)}
        </span>
      ) : null}
      <span className="truncate">{title}</span>
    </button>
  );
}
