import { formatDuration } from '@/lib/utils';
import { sessionTotals, type SessionForTotals } from '@/lib/childcare';
import { formatDayLong, formatTime } from '@/lib/datetime';

export type SessionExportRow = {
  session: SessionForTotals;
  extras: { label: string; amount: number }[];
  childNames: string[];
};

const STATUS_LABELS: Record<string, string> = {
  prevue: 'Prévue',
  a_confirmer: 'À confirmer',
  confirmee: 'Confirmée',
  annulee: 'Annulée',
};

/** Échappement CSV : guillemets doublés, champ encadré si nécessaire. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Bilan mensuel au format CSV.
 *
 * Le séparateur est le point-virgule et les décimales sont des virgules :
 * c'est ce qu'attend un tableur configuré en français, sinon tout atterrit
 * dans une seule colonne.
 */
export function buildMonthlyCsv(
  rows: SessionExportRow[],
  meta: { nannyName: string; month: string; timezone: string },
): string {
  const header = [
    'Date',
    'Enfants',
    'Début prévu',
    'Fin prévue',
    'Heures prévues',
    'Début réel',
    'Fin réelle',
    'Pause (min)',
    'Correction (min)',
    'Motif de la correction',
    'Heures réalisées',
    'Tarif horaire (EUR)',
    'Montant heures (EUR)',
    'Frais (EUR)',
    'Total (EUR)',
    'Statut',
  ];

  const decimal = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value).replace('.', ',');

  const lines = rows.map(({ session, extras, childNames }) => {
    const totals = sessionTotals(session, extras);
    const tz = meta.timezone;

    return [
      session.scheduled_start.slice(0, 10),
      childNames.join(', '),
      formatTime(session.scheduled_start, tz),
      formatTime(session.scheduled_end, tz),
      decimal(Math.round((totals.scheduledMinutes / 60) * 100) / 100),
      session.actual_start ? formatTime(session.actual_start, tz) : '',
      session.actual_end ? formatTime(session.actual_end, tz) : '',
      session.unpaid_break_minutes || '',
      session.adjustment_minutes || '',
      '',
      totals.workedMinutes === null
        ? ''
        : decimal(Math.round((totals.workedMinutes / 60) * 100) / 100),
      decimal(Number(session.applied_hourly_rate)),
      decimal(totals.hoursAmount),
      decimal(totals.extrasTotal || null),
      decimal(totals.totalAmount),
      STATUS_LABELS[session.status] ?? session.status,
    ]
      .map(csvField)
      .join(';');
  });

  const title = `Bilan des heures — ${meta.nannyName} — ${meta.month}`;
  const disclaimer =
    "Suivi des heures et estimation. Ce document n'est ni une fiche de paie ni une déclaration officielle.";

  return [
    csvField(title),
    csvField(disclaimer),
    '',
    header.map(csvField).join(';'),
    ...lines,
  ].join('\r\n');
}

/** Déclenche le téléchargement d'un fichier généré dans le navigateur. */
export function downloadFile(content: string, fileName: string, mimeType: string) {
  // Le BOM fait reconnaître l'UTF-8 aux tableurs sous Windows, sans quoi les
  // accents s'affichent en caractères parasites.
  const blob = new Blob([mimeType.includes('csv') ? '﻿' + content : content], {
    type: mimeType,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Nom de fichier sûr, sans accents ni espaces. */
export function safeSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export { formatDayLong, formatDuration, STATUS_LABELS };
