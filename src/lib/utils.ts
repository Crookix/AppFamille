import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Palette assignée aux membres et aux enfants du foyer. */
export const MEMBER_COLORS = [
  { key: 'terracotta', label: 'Terracotta', hex: '#de6f47' },
  { key: 'sauge', label: 'Sauge', hex: '#6da887' },
  { key: 'miel', label: 'Miel', hex: '#e9b04a' },
  { key: 'lavande', label: 'Lavande', hex: '#8b7bb8' },
  { key: 'ocean', label: 'Océan', hex: '#4a90a4' },
  { key: 'framboise', label: 'Framboise', hex: '#c9628a' },
  { key: 'olive', label: 'Olive', hex: '#8a9a5b' },
  { key: 'ardoise', label: 'Ardoise', hex: '#6b7a8f' },
] as const;

export type MemberColorKey = (typeof MEMBER_COLORS)[number]['key'];

export function colorHex(key: string | null | undefined): string {
  return MEMBER_COLORS.find((c) => c.key === key)?.hex ?? '#8a7867';
}

/**
 * Choisit la prochaine couleur libre du foyer, en repartant du début
 * lorsque toutes ont été utilisées.
 */
export function nextFreeColor(used: string[]): MemberColorKey {
  const free = MEMBER_COLORS.find((c) => !used.includes(c.key));
  if (free) return free.key;
  return MEMBER_COLORS[used.length % MEMBER_COLORS.length].key;
}

/** Initiales affichées dans les pastilles d'avatar. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Formate un nombre d'euros en français, sans décimales inutiles. */
export function formatEuros(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** « 3 h 25 » à partir d'un nombre de minutes. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${String(m).padStart(2, '0')}`;
}

/** Identifiant court non cryptographique, pour les clés d'UI optimiste. */
export function tempId(): string {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}
