'use client';

import * as React from 'react';
import { Paperclip, Plane, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AvatarStack } from '@/components/ui/avatar';
import { useHousehold } from '@/components/providers/household-provider';
import { CATEGORY_META, type CategoryKey } from '@/components/events/pickers';
import {
  daySegment,
  fillsWholeDay,
  layoutOverlaps,
  wallMinutes,
  type PositionedBlock,
} from '@/lib/calendar-layout';
import { formatDayLong, formatTime } from '@/lib/datetime';
import type { SerializedOccurrence } from '@/lib/data/calendar';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Première heure montrée à l'ouverture, quand la journée est vide. */
const DEFAULT_SCROLL_HOUR = 7;

const WEEKDAY_LETTERS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

function weekdayShort(day: string): string {
  return WEEKDAY_LETTERS[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

function categoryOf(item: SerializedOccurrence) {
  return CATEGORY_META[item.event.category as CategoryKey] ?? CATEGORY_META.famille;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

type DayLayout = {
  day: string;
  allDay: SerializedOccurrence[];
  timed: PositionedBlock<SerializedOccurrence>[];
};

/**
 * Grille horaire, façon agenda : les heures en colonne, les jours en ligne,
 * et chaque événement dessiné à sa place et à sa taille.
 *
 * C'est ce qui manquait le plus à l'ancien calendrier : une liste dit *ce
 * qu'il y a*, une grille dit *ce qu'il reste*. On y voit d'un coup d'œil qu'un
 * mercredi est chargé de 14 h à 18 h, et qu'il reste la matinée.
 *
 * Elle sert les vues « Jour » (une colonne) et « Semaine » (sept), et se lit
 * à 375 px : au besoin les colonnes se resserrent, le libellé reste.
 */
export function TimeGrid({
  days,
  occurrences,
  tz,
  today,
  withAttachments,
  onOpen,
  onCreate,
  onPickDay,
}: {
  days: string[];
  occurrences: SerializedOccurrence[];
  tz: string;
  today: string;
  withAttachments: Set<string>;
  onOpen: (item: SerializedOccurrence) => void;
  onCreate: (day: string, time: string) => void;
  onPickDay?: (day: string) => void;
}) {
  const { members, children } = useHousehold();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const single = days.length === 1;

  /* Les occurrences rangées jour par jour : celles qui tiennent la journée
     entière d'un côté, les autres placées à l'heure et réparties en colonnes
     quand elles se chevauchent. */
  const layout = React.useMemo<DayLayout[]>(
    () =>
      days.map((day) => {
        const allDay: SerializedOccurrence[] = [];
        const timed: { item: SerializedOccurrence; startMin: number; endMin: number }[] = [];

        for (const item of occurrences) {
          const segment = daySegment(item.startsAt, item.endsAt, day, tz);
          if (!segment) continue;
          if (item.event.all_day || fillsWholeDay(segment)) {
            allDay.push(item);
          } else {
            timed.push({ item, startMin: segment.startMin, endMin: segment.endMin });
          }
        }

        return { day, allDay, timed: layoutOverlaps(timed) };
      }),
    [days, occurrences, tz],
  );

  /* Le trait de l'heure courante. Il ne peut pas être calculé au rendu du
     serveur — l'heure y serait déjà fausse à l'affichage, et le HTML ne
     correspondrait pas à celui du navigateur. */
  const [nowMin, setNowMin] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNowMin(wallMinutes(new Date(), tz));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [tz]);

  /* À l'ouverture, on se place sur le premier événement de la période plutôt
     qu'à minuit : personne ne veut faire défiler sept heures de nuit vide. */
  const firstEventMin = React.useMemo(() => {
    const starts = layout.flatMap((d) => d.timed.map((b) => b.startMin));
    return starts.length > 0 ? Math.min(...starts) : null;
  }, [layout]);

  const firstDay = days[0];
  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const hourHeight = node.scrollHeight / 24;
    // Trois quarts d'heure de marge : l'étiquette de l'heure est centrée sur
    // sa ligne, et se retrouverait coupée en deux si on s'arrêtait dessus.
    const target =
      firstEventMin !== null
        ? Math.max(0, firstEventMin / 60 - 0.75)
        : DEFAULT_SCROLL_HOUR;
    node.scrollTop = target * hourHeight;
    // Se repositionner à chaque changement de période, pas à chaque rendu.
  }, [firstDay, firstEventMin]);

  const columns = `2.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const hasAllDay = layout.some((d) => d.allDay.length > 0);

  /** Clic dans le vide : on propose de créer à l'heure visée. */
  function createAt(nativeEvent: React.MouseEvent<HTMLButtonElement>, day: string) {
    const rect = nativeEvent.currentTarget.getBoundingClientRect();
    // `detail` vaut 0 quand l'activation vient du clavier : il n'y a alors
    // aucune position à lire, on propose le début de journée.
    const minutes =
      nativeEvent.detail === 0 || rect.height === 0
        ? DEFAULT_SCROLL_HOUR * 60
        : Math.round(
            (((nativeEvent.clientY - rect.top) / rect.height) * 1440) / 30,
          ) * 30;
    const clamped = Math.min(23 * 60 + 30, Math.max(0, minutes));
    onCreate(day, `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`);
  }

  return (
    <div className="surface overflow-hidden rounded-[var(--radius-xl2)] [--hour:3rem] sm:[--hour:3.5rem]">
      {/* --- Entête des jours ---------------------------------------------- */}
      <div
        className="grid border-b border-[var(--line)]"
        style={{ gridTemplateColumns: columns }}
      >
        <div aria-hidden />
        {days.map((day) => {
          const isToday = day === today;
          const header = (
            <>
              <span className="text-[0.65rem] font-semibold uppercase text-muted">
                {weekdayShort(day)}
              </span>
              <span
                className={cn(
                  'flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-bold tabular-nums',
                  isToday && 'bg-brand-500 text-white',
                )}
              >
                {Number(day.slice(-2))}
              </span>
            </>
          );

          return onPickDay ? (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              aria-label={`Voir le ${formatDayLong(day)}`}
              className="flex flex-col items-center gap-0.5 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
            >
              {header}
            </button>
          ) : (
            <div key={day} className="flex flex-col items-center gap-0.5 py-2">
              {header}
            </div>
          );
        })}
      </div>

      {/* --- Journées entières --------------------------------------------- */}
      {hasAllDay ? (
        <div
          className="grid border-b border-[var(--line)] bg-[var(--bg-subtle)]/40"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="flex items-start justify-end pr-1.5 pt-1.5">
            <span className="text-[0.6rem] font-semibold uppercase text-muted">Jour</span>
          </div>
          {layout.map(({ day, allDay }) => (
            <div key={day} className="min-w-0 space-y-0.5 border-l border-[var(--line)] p-1">
              {allDay.slice(0, 3).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onOpen(item)}
                  title={item.event.is_busy_only ? 'Occupé' : item.event.title}
                  className="block w-full truncate rounded-md px-1.5 py-1 text-left text-[0.7rem] font-semibold text-white"
                  style={{ backgroundColor: categoryOf(item).color }}
                >
                  {item.event.is_busy_only ? 'Occupé' : item.event.title}
                </button>
              ))}
              {allDay.length > 3 ? (
                <button
                  type="button"
                  onClick={() => onPickDay?.(day)}
                  className="block w-full px-1.5 text-left text-[0.65rem] font-bold text-muted"
                >
                  +{allDay.length - 3}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* --- Heures --------------------------------------------------------- */}
      <div
        ref={scrollRef}
        className="relative max-h-[62vh] overflow-y-auto overscroll-contain"
      >
        <div
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: 'calc(var(--hour) * 24)' }}
        >
          {/* Colonne des heures */}
          <div className="relative">
            {HOURS.slice(1).map((h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[0.65rem] font-semibold text-muted tabular-nums"
                style={{ top: `calc(var(--hour) * ${h})` }}
              >
                {h} h
              </span>
            ))}
          </div>

          {layout.map(({ day, timed }) => (
            <div
              key={day}
              className="relative border-l border-[var(--line)]"
              style={{
                // Les lignes d'heures sont peintes plutôt que posées : une
                // bordure par heure et par jour, ce serait 168 éléments.
                backgroundImage:
                  'repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px calc(var(--hour)))',
              }}
            >
              <button
                type="button"
                onClick={(nativeEvent) => createAt(nativeEvent, day)}
                aria-label={`Ajouter un événement le ${formatDayLong(day)}`}
                className="absolute inset-0 z-0 w-full cursor-copy"
              />

              {timed.map(({ item, startMin, endMin, column, columns: count }) => (
                <EventBlock
                  key={item.key}
                  item={item}
                  startMin={startMin}
                  endMin={endMin}
                  column={column}
                  columns={count}
                  tz={tz}
                  detailed={single}
                  hasAttachments={withAttachments.has(item.event.id)}
                  people={
                    single
                      ? [
                          ...item.memberIds
                            .map((id) => members.find((m) => m.id === id))
                            .filter(Boolean)
                            .map((m) => ({ name: m!.display_name, color: m!.color })),
                          ...item.childIds
                            .map((id) => children.find((c) => c.id === id))
                            .filter(Boolean)
                            .map((c) => ({ name: c!.first_name, color: c!.color })),
                        ]
                      : []
                  }
                  onOpen={onOpen}
                />
              ))}

              {nowMin !== null && day === today ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                  style={{ top: `calc(var(--hour) * ${nowMin / 60})` }}
                  aria-hidden
                >
                  <span className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-alert-500)]" />
                  <span className="h-px flex-1 bg-[var(--color-alert-500)]" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Un événement dessiné à sa place dans la grille. */
function EventBlock({
  item,
  startMin,
  endMin,
  column,
  columns,
  tz,
  detailed,
  hasAttachments,
  people,
  onOpen,
}: {
  item: SerializedOccurrence;
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
  tz: string;
  detailed: boolean;
  hasAttachments: boolean;
  people: { name: string; color: string | null }[];
  onOpen: (item: SerializedOccurrence) => void;
}) {
  const color = categoryOf(item).color;
  const title = item.event.is_busy_only ? 'Occupé' : item.event.title;
  const duration = endMin - startMin;
  const roomy = duration >= 45;

  return (
    <div
      className="absolute z-10 p-px"
      style={{
        top: `calc(var(--hour) * ${startMin / 60})`,
        height: `calc(var(--hour) * ${Math.max(duration, 15) / 60})`,
        left: `${(column / columns) * 100}%`,
        width: `${(1 / columns) * 100}%`,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        title={`${formatTime(item.startsAt, tz)} – ${formatTime(item.endsAt, tz)} · ${title}`}
        className="flex h-full w-full flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left leading-tight transition-opacity hover:opacity-90"
        style={{
          borderLeftColor: color,
          // Un aplat pâle de la couleur de catégorie : le texte reste lisible
          // dans les deux thèmes, ce que du blanc sur du miel ne ferait pas.
          backgroundColor: `color-mix(in srgb, ${color} 22%, var(--bg-elevated))`,
        }}
      >
        <span className="flex items-center gap-1 truncate text-[0.7rem] font-bold">
          <span className="truncate">{title}</span>
          {item.event.kind === 'deplacement' ? (
            <Plane className="h-3 w-3 shrink-0 text-muted" aria-label="Déplacement" />
          ) : null}
          {item.isRecurring ? (
            <Repeat className="h-3 w-3 shrink-0 text-muted" aria-label="Répété" />
          ) : null}
          {hasAttachments ? (
            <Paperclip className="h-3 w-3 shrink-0 text-muted" aria-label="Pièce jointe" />
          ) : null}
        </span>

        {roomy ? (
          <span className="truncate text-[0.65rem] text-muted tabular-nums">
            {formatTime(item.startsAt, tz)}
            {detailed ? ` – ${formatTime(item.endsAt, tz)}` : ''}
          </span>
        ) : null}

        {detailed && item.event.location && duration >= 90 ? (
          <span className="truncate text-[0.65rem] text-muted">{item.event.location}</span>
        ) : null}

        {detailed && people.length > 0 && duration >= 60 ? (
          <span className="mt-auto pb-0.5">
            <AvatarStack people={people} size="xs" max={4} />
          </span>
        ) : null}
      </button>
    </div>
  );
}
