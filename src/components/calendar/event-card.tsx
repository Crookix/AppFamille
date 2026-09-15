'use client';

import * as React from 'react';
import { Clock, MapPin, Paperclip, Plane, Repeat, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { useHousehold } from '@/components/providers/household-provider';
import { CATEGORY_META, type CategoryKey } from '@/components/events/pickers';
import { formatTime } from '@/lib/datetime';
import type { SerializedOccurrence } from '@/lib/data/calendar';

/**
 * Carte d'un événement dans les listes du calendrier et de l'accueil.
 *
 * L'heure et les personnes concernées passent avant tout le reste : la
 * question qu'on se pose en ouvrant l'application est « qui, quand ».
 */
export function EventCard({
  item,
  onOpen,
  showDate,
  compact,
  hasAttachments,
}: {
  item: SerializedOccurrence;
  onOpen?: (item: SerializedOccurrence) => void;
  showDate?: boolean;
  compact?: boolean;
  hasAttachments?: boolean;
}) {
  const { members, children, household } = useHousehold();
  const { event } = item;
  const category = CATEGORY_META[event.category as CategoryKey] ?? CATEGORY_META.famille;

  const people = [
    ...item.memberIds
      .map((id) => members.find((m) => m.id === id))
      .filter(Boolean)
      .map((m) => ({ name: m!.display_name, color: m!.color })),
    ...item.childIds
      .map((id) => children.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => ({ name: c!.first_name, color: c!.color })),
  ];

  const responsible = event.responsible_member_id
    ? members.find((m) => m.id === event.responsible_member_id)
    : null;

  const start = formatTime(item.startsAt, event.timezone || household.timezone);
  const end = formatTime(item.endsAt, event.timezone || household.timezone);

  const Wrapper = onOpen ? 'button' : 'div';

  return (
    <Wrapper
      {...(onOpen
        ? { type: 'button' as const, onClick: () => onOpen(item) }
        : {})}
      className={cn(
        'surface relative w-full overflow-hidden rounded-[var(--radius-xl2)] text-left transition-transform',
        onOpen && 'active:scale-[0.99]',
        compact ? 'p-3 pl-4' : 'p-3.5 pl-4.5',
      )}
    >
      {/* Bande de couleur : la catégorie se lit sans lire. */}
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: category.color }}
        aria-hidden
      />

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-bold leading-tight">
              {event.is_busy_only ? 'Occupé' : event.title}
            </p>
            {event.kind === 'deplacement' ? (
              <Plane className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Déplacement" />
            ) : null}
            {item.isRecurring ? (
              <Repeat className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Répété" />
            ) : null}
            {hasAttachments ? (
              <Paperclip
                className="h-3.5 w-3.5 shrink-0 text-muted"
                aria-label="Pièce jointe"
              />
            ) : null}
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {event.all_day ? 'Journée entière' : `${start} – ${end}`}
            </span>
            {event.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </p>

          {!compact && (responsible || people.length > 0) ? (
            <div className="mt-2 flex items-center gap-2">
              {people.length > 0 ? <AvatarStack people={people} size="xs" /> : null}
              {responsible ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <Users className="h-3 w-3" aria-hidden />
                  {responsible.display_name}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {compact && people.length > 0 ? <AvatarStack people={people} size="xs" max={3} /> : null}
      </div>
    </Wrapper>
  );
}

/** Pastille d'un membre, utilisée dans les entêtes de jour. */
export function PersonBadge({
  name,
  color,
}: {
  name: string;
  color: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
      <Avatar name={name} color={color} size="xs" />
      {name}
    </span>
  );
}
