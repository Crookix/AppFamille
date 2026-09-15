import { describe, expect, it } from 'vitest';
import {
  MINUTES_PER_DAY,
  daySegment,
  fillsWholeDay,
  layoutOverlaps,
  wallMinutes,
} from '@/lib/calendar-layout';

const TZ = 'Europe/Paris';

describe('wallMinutes', () => {
  it('lit l’heure à la pendule du fuseau demandé', () => {
    // 07:30 UTC en hiver, soit 08:30 à Paris.
    expect(wallMinutes('2026-01-15T07:30:00.000Z', TZ)).toBe(8 * 60 + 30);
    // Le même instant, lu à Londres.
    expect(wallMinutes('2026-01-15T07:30:00.000Z', 'Europe/London')).toBe(7 * 60 + 30);
  });
});

describe('daySegment', () => {
  it('place un rendez-vous ordinaire entre ses deux heures', () => {
    const segment = daySegment(
      '2026-03-04T08:00:00.000Z',
      '2026-03-04T09:30:00.000Z',
      '2026-03-04',
      TZ,
    );
    expect(segment).toEqual({
      startMin: 9 * 60,
      endMin: 10 * 60 + 30,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('renvoie null pour une journée que l’événement ne touche pas', () => {
    expect(
      daySegment('2026-03-04T08:00:00.000Z', '2026-03-04T09:00:00.000Z', '2026-03-05', TZ),
    ).toBeNull();
    expect(
      daySegment('2026-03-04T08:00:00.000Z', '2026-03-04T09:00:00.000Z', '2026-03-03', TZ),
    ).toBeNull();
  });

  it('découpe un séjour de trois jours en trois tranches', () => {
    const start = '2026-07-10T16:00:00.000Z'; // 18 h à Paris
    const end = '2026-07-12T08:00:00.000Z'; // 10 h à Paris

    expect(daySegment(start, end, '2026-07-10', TZ)).toEqual({
      startMin: 18 * 60,
      endMin: MINUTES_PER_DAY,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(daySegment(start, end, '2026-07-11', TZ)).toEqual({
      startMin: 0,
      endMin: MINUTES_PER_DAY,
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(daySegment(start, end, '2026-07-12', TZ)).toEqual({
      startMin: 0,
      endMin: 10 * 60,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('rattache une soirée qui finit à minuit à la veille', () => {
    const start = '2026-07-10T18:00:00.000Z'; // 20 h
    const end = '2026-07-10T22:00:00.000Z'; // minuit

    expect(daySegment(start, end, '2026-07-10', TZ)).toEqual({
      startMin: 20 * 60,
      endMin: MINUTES_PER_DAY,
      continuesBefore: false,
      continuesAfter: false,
    });
    // Rien ne doit déborder sur le lendemain.
    expect(daySegment(start, end, '2026-07-11', TZ)).toBeNull();
  });

  it('couvre la journée entière pour un événement « journée »', () => {
    const segment = daySegment(
      '2026-07-10T22:00:00.000Z',
      '2026-07-11T22:00:00.000Z',
      '2026-07-11',
      TZ,
    )!;
    expect(segment.startMin).toBe(0);
    expect(segment.endMin).toBe(MINUTES_PER_DAY);
    expect(fillsWholeDay(segment)).toBe(true);
  });

  it('suit la pendule le dimanche du changement d’heure', () => {
    // 29 mars 2026 : à 2 h, il est 3 h. Un rendez-vous affiché à 9 h doit le
    // rester, même si la journée ne dure que 23 heures.
    const segment = daySegment(
      '2026-03-29T07:00:00.000Z',
      '2026-03-29T08:00:00.000Z',
      '2026-03-29',
      TZ,
    );
    expect(segment).toEqual({
      startMin: 9 * 60,
      endMin: 10 * 60,
      continuesBefore: false,
      continuesAfter: false,
    });
  });
});

describe('layoutOverlaps', () => {
  function positions(blocks: { item: string; startMin: number; endMin: number }[]) {
    return Object.fromEntries(
      layoutOverlaps(blocks).map((b) => [b.item, `${b.column}/${b.columns}`]),
    );
  }

  it('laisse toute la largeur à des événements qui ne se croisent pas', () => {
    expect(
      positions([
        { item: 'a', startMin: 540, endMin: 600 },
        { item: 'b', startMin: 660, endMin: 720 },
      ]),
    ).toEqual({ a: '0/1', b: '0/1' });
  });

  it('partage la largeur entre deux événements qui se chevauchent', () => {
    expect(
      positions([
        { item: 'a', startMin: 540, endMin: 660 },
        { item: 'b', startMin: 600, endMin: 720 },
      ]),
    ).toEqual({ a: '0/2', b: '1/2' });
  });

  it('propage la largeur à tout un groupe enchaîné', () => {
    // a et c ne se croisent pas, mais b croise les deux : les trois
    // appartiennent au même groupe, sur deux colonnes.
    expect(
      positions([
        { item: 'a', startMin: 540, endMin: 600 },
        { item: 'b', startMin: 570, endMin: 690 },
        { item: 'c', startMin: 630, endMin: 700 },
      ]),
    ).toEqual({ a: '0/2', b: '1/2', c: '0/2' });
  });

  it('sépare deux groupes distincts', () => {
    const result = layoutOverlaps([
      { item: 'a', startMin: 540, endMin: 660 },
      { item: 'b', startMin: 600, endMin: 660 },
      { item: 'c', startMin: 780, endMin: 840 },
    ]);
    expect(result.find((b) => b.item === 'c')!.columns).toBe(1);
  });

  it('empêche deux rendez-vous très courts de se recouvrir', () => {
    // Cinq minutes chacun, à dix minutes d'écart : ils se dessineraient l'un
    // sur l'autre si on les croyait disjoints.
    expect(
      positions([
        { item: 'a', startMin: 540, endMin: 545 },
        { item: 'b', startMin: 550, endMin: 555 },
      ]),
    ).toEqual({ a: '0/2', b: '1/2' });
  });
});
