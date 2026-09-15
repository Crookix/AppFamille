import { describe, expect, it } from 'vitest';
import { formatWeekRange } from '@/lib/datetime';

describe('formatWeekRange', () => {
  it('ne nomme le mois qu’une fois quand la semaine y tient', () => {
    expect(formatWeekRange('2026-10-05')).toBe('5 – 11 octobre');
  });

  it('nomme les deux mois quand la semaine est à cheval', () => {
    expect(formatWeekRange('2026-09-28')).toBe('28 septembre – 4 octobre');
  });

  it('écrit « 1er » plutôt que « 1 »', () => {
    expect(formatWeekRange('2026-06-01')).toBe('1er – 7 juin');
  });
});
