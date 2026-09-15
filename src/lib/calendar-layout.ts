import { addDays, dayKey, formatTime } from '@/lib/datetime';

/**
 * Placement des événements sur une grille horaire.
 *
 * Deux questions, deux fonctions : « quelle tranche de la journée cet
 * événement occupe-t-il ? » (`daySegment`) et « comment ranger côte à côte
 * ceux qui se chevauchent ? » (`layoutOverlaps`). Elles ne dépendent d'aucun
 * composant : c'est ce qui permet de les vérifier dans `tests/unit`.
 */

export const MINUTES_PER_DAY = 1440;

/** Tranche occupée par un événement sur une journée civile donnée. */
export type DaySegment = {
  /** Minutes depuis minuit, à la pendule du foyer. */
  startMin: number;
  endMin: number;
  /** L'événement a commencé la veille ou plus tôt. */
  continuesBefore: boolean;
  /** Il se poursuit le lendemain ou au-delà. */
  continuesAfter: boolean;
};

/** Minutes écoulées depuis minuit, telles qu'on les lit à la pendule. */
export function wallMinutes(instant: Date | string, tz: string): number {
  const [h, m] = formatTime(instant, tz).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Tranche d'un événement sur `day`, ou `null` s'il n'y passe pas.
 *
 * On raisonne en heure murale plutôt qu'en durée réelle : un rendez-vous de
 * 9 h à 10 h se dessine entre les lignes « 9 » et « 10 », y compris le
 * dimanche du changement d'heure où cette heure-là en dure deux ou zéro. C'est
 * ce que montre une pendule, et donc ce qu'attend la personne qui lit.
 *
 * Un événement qui se termine exactement à minuit appartient à la veille : sans
 * cela, une soirée 20 h – minuit laisserait une trace vide sur le lendemain.
 */
export function daySegment(
  startsAt: Date | string,
  endsAt: Date | string,
  day: string,
  tz: string,
): DaySegment | null {
  const startDay = dayKey(startsAt, tz);
  const rawEndDay = dayKey(endsAt, tz);
  const rawEndMin = wallMinutes(endsAt, tz);

  const endsAtMidnight = rawEndMin === 0 && rawEndDay > startDay;
  const endDay = endsAtMidnight ? addDays(rawEndDay, -1) : rawEndDay;

  if (day < startDay || day > endDay) return null;

  const startMin = day === startDay ? wallMinutes(startsAt, tz) : 0;
  const endMin =
    day === endDay
      ? endsAtMidnight
        ? MINUTES_PER_DAY
        : rawEndMin
      : MINUTES_PER_DAY;

  return {
    startMin,
    endMin: Math.max(endMin, startMin),
    continuesBefore: day > startDay,
    continuesAfter: day < endDay,
  };
}

/** Un événement occupe-t-il la journée entière (ou davantage) ? */
export function fillsWholeDay(segment: DaySegment): boolean {
  return segment.startMin === 0 && segment.endMin >= MINUTES_PER_DAY;
}

export type Block<T> = { item: T; startMin: number; endMin: number };

export type PositionedBlock<T> = Block<T> & {
  /** Colonne occupée, de 0 à `columns - 1`. */
  column: number;
  /** Nombre de colonnes à se partager dans le groupe qui se chevauche. */
  columns: number;
};

/**
 * Range côte à côte les événements qui se chevauchent.
 *
 * On avance dans l'ordre chronologique en gardant un groupe courant. Tant
 * qu'un événement commence avant la fin du groupe, il le rejoint et prend la
 * première colonne libre ; sinon le groupe est clos et tous ses membres se
 * partagent la largeur à parts égales.
 *
 * `minDurationMin` donne une durée plancher **pour le calcul des
 * chevauchements seulement** : deux rendez-vous de cinq minutes qui se suivent
 * se dessinent l'un sous l'autre sur quelques pixels, et se recouvriraient
 * visuellement si on les croyait disjoints.
 */
export function layoutOverlaps<T>(
  blocks: Block<T>[],
  minDurationMin = 30,
): PositionedBlock<T>[] {
  const effectiveEnd = (b: Block<T>) => Math.max(b.endMin, b.startMin + minDurationMin);

  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || effectiveEnd(b) - effectiveEnd(a),
  );

  const placed: PositionedBlock<T>[] = [];
  let group: PositionedBlock<T>[] = [];
  let columnEnds: number[] = [];

  function closeGroup() {
    for (const entry of group) entry.columns = columnEnds.length;
    placed.push(...group);
    group = [];
    columnEnds = [];
  }

  for (const block of sorted) {
    const groupEnd = columnEnds.length > 0 ? Math.max(...columnEnds) : -1;
    if (block.startMin >= groupEnd) closeGroup();

    let column = columnEnds.findIndex((end) => end <= block.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[column] = effectiveEnd(block);

    group.push({ ...block, column, columns: 1 });
  }

  closeGroup();
  return placed;
}
