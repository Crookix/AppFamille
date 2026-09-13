'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Link2Off,
  RefreshCw,
  ShieldQuestion,
  Unplug,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorNote, Field, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { updateGoogleCalendarAction } from '@/lib/actions/google';
import { useHousehold } from '@/components/providers/household-provider';
import { cn } from '@/lib/utils';
import { formatDayLong, formatTime } from '@/lib/datetime';
import type {
  GoogleAccountRow,
  GoogleCalendarRow,
  GoogleShareMode,
  GoogleSyncRunRow,
} from '@/lib/database.types';

const ERROR_MESSAGES: Record<string, string> = {
  non_configure:
    "Google Agenda n'est pas configuré sur cette installation. Les identifiants OAuth manquent — voir docs/GOOGLE.md.",
  cle_chiffrement:
    "La clé de chiffrement des jetons (TOKEN_ENCRYPTION_KEY) est absente ou invalide. L'autorisation est refusée tant qu'elle n'est pas en place.",
  refus: "L'autorisation a été refusée dans la fenêtre Google.",
  reponse_incomplete: 'Google a renvoyé une réponse incomplète. Réessayez.',
  etat_invalide:
    "La demande d'autorisation n'a pas pu être vérifiée. Relancez la connexion depuis cette page.",
  echange_refuse:
    "Google a refusé l'échange du code. Vérifiez l'URI de redirection déclarée dans la console Google Cloud.",
  portee_refusee:
    "L'accès à l'agenda n'a pas été accordé. Cochez bien l'autorisation Google Agenda dans la fenêtre de consentement.",
  identite_absente: "Google n'a pas renvoyé l'identité du compte.",
  enregistrement: "Le compte Google n'a pas pu être enregistré.",
  liste_calendriers:
    "Le compte est relié mais la liste des calendriers n'a pas pu être récupérée.",
  aucun_foyer: 'Créez ou rejoignez un foyer avant de connecter un agenda.',
};

export function GoogleSettings({
  configured,
  serviceKeyPresent,
  encryptionConfigured,
  account,
  calendars,
  runs,
  initialError,
  justConnected,
}: {
  configured: boolean;
  serviceKeyPresent: boolean;
  encryptionConfigured: boolean;
  account: GoogleAccountRow | null;
  calendars: GoogleCalendarRow[];
  runs: GoogleSyncRunRow[];
  initialError?: string | null;
  justConnected?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { household } = useHousehold();

  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? "L'autorisation a échoué.") : null,
  );
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [removeEvents, setRemoveEvents] = React.useState(false);
  const [pendingCalendar, setPendingCalendar] = React.useState<string | null>(null);

  const selected = calendars.filter((c) => c.is_selected);
  const lastRun = runs[0] ?? null;
  const writable = calendars.filter(
    (c) => c.access_role === 'owner' || c.access_role === 'writer',
  );

  async function updateCalendar(
    calendarId: string,
    patch: Partial<Pick<GoogleCalendarRow, 'is_selected' | 'share_mode' | 'is_write_target'>>,
  ) {
    setPendingCalendar(calendarId);
    setError(null);

    const result = await updateGoogleCalendarAction({
      calendarId,
      isSelected: patch.is_selected,
      shareMode: patch.share_mode,
      isWriteTarget: patch.is_write_target,
    });

    setPendingCalendar(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function runSync() {
    setSyncing(true);
    setError(null);

    try {
      const response = await fetch('/api/google/sync', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? 'La synchronisation a échoué.');
        return;
      }

      const { imported, updated, exported, deleted, conflicts } = payload.totals;

      if (!payload.ok) {
        const failedNames = (payload.outcomes ?? [])
          .filter((o: { status: string }) => o.status === 'echec')
          .map((o: { calendarName: string }) => o.calendarName)
          .join(', ');
        setError(`Certains calendriers ont échoué : ${failedNames}.`);
      }

      const parts = [
        imported ? `${imported} importé(s)` : null,
        updated ? `${updated} mis à jour` : null,
        exported ? `${exported} envoyé(s)` : null,
        deleted ? `${deleted} supprimé(s)` : null,
      ].filter(Boolean);

      toast.success(
        parts.length > 0 ? `Synchronisation : ${parts.join(', ')}.` : 'Déjà à jour.',
      );

      if (conflicts > 0) {
        toast.toast(
          `${conflicts} événement(s) modifié(s) des deux côtés : la version Google a été conservée.`,
          { tone: 'info' },
        );
      }
    } catch {
      setError("La synchronisation n'a pas pu être lancée. Vérifiez votre connexion.");
    } finally {
      setSyncing(false);
      router.refresh();
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch(
        `/api/google/disconnect${removeEvents ? '?supprimer=1' : ''}`,
        { method: 'POST' },
      );
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? 'La déconnexion a échoué.');
        return;
      }

      toast.success(
        removeEvents
          ? 'Agenda déconnecté et événements importés supprimés.'
          : 'Agenda déconnecté. Les événements importés restent dans le foyer.',
      );
      setConfirmDisconnect(false);
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  /* --- Installation incomplète ---------------------------------------- */
  if (!configured) {
    return (
      <Shell>
        <SetupChecklist
          configured={configured}
          encryptionConfigured={encryptionConfigured}
          serviceKeyPresent={serviceKeyPresent}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {error ? <ErrorNote className="mb-4">{error}</ErrorNote> : null}

      {justConnected && !error ? (
        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-sage-100 px-3.5 py-2.5 text-sm font-medium text-sage-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Agenda autorisé. Choisissez maintenant les calendriers à afficher.
        </p>
      ) : null}

      {/* --- État de la connexion ---------------------------------------- */}
      <Card className="mb-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              account?.calendar_authorized
                ? 'bg-sage-100 text-sage-700'
                : 'bg-[var(--bg-subtle)] text-muted',
            )}
          >
            <CalendarCheck className="h-5 w-5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {account?.calendar_authorized
                ? 'Agenda Google autorisé'
                : 'Agenda Google non autorisé'}
            </p>
            <p className="text-sm text-muted">
              {account?.email ??
                "Autorisez l'accès pour afficher vos calendriers dans Tribu."}
            </p>

            {account?.last_error ? (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-alert-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {account.last_error}
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-muted">
          <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Se connecter à Tribu avec Google et autoriser l'accès à Google Agenda sont
            deux choses distinctes. Vous pouvez retirer l'accès à l'agenda à tout
            moment sans perdre votre compte.
          </span>
        </p>

        <div className="mt-3 flex gap-2">
          {account?.calendar_authorized ? (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmDisconnect(true)}
              >
                <Unplug className="h-4 w-4" aria-hidden />
                Déconnecter
              </Button>
              <Button
                className="flex-1"
                onClick={runSync}
                loading={syncing}
                disabled={selected.length === 0}
              >
                {syncing ? null : <RefreshCw className="h-4 w-4" aria-hidden />}
                Synchroniser
              </Button>
            </>
          ) : (
            <Link
              href="/api/google/connect"
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-brand-500 px-5 font-semibold text-white transition-colors hover:bg-brand-600"
            >
              <CalendarCheck className="h-4 w-4" aria-hidden />
              Autoriser Google Agenda
            </Link>
          )}
        </div>
      </Card>

      {(!encryptionConfigured || !serviceKeyPresent) && account?.calendar_authorized ? (
        <div className="mb-4">
          <SetupChecklist
            configured={configured}
            encryptionConfigured={encryptionConfigured}
            serviceKeyPresent={serviceKeyPresent}
          />
        </div>
      ) : null}

      {/* --- Calendriers -------------------------------------------------- */}
      {account?.calendar_authorized ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Calendriers
          </h2>

          {calendars.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">Aucun calendrier trouvé sur ce compte.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {calendars.map((calendar) => {
                const readOnly = !(
                  calendar.access_role === 'owner' || calendar.access_role === 'writer'
                );

                return (
                  <Card key={calendar.id} className="p-3">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={calendar.is_selected}
                        disabled={pendingCalendar === calendar.id}
                        onChange={(e) =>
                          updateCalendar(calendar.id, { is_selected: e.target.checked })
                        }
                        className="mt-1 h-4.5 w-4.5 shrink-0 accent-[var(--color-brand-500)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {calendar.background_color ? (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: calendar.background_color }}
                              aria-hidden
                            />
                          ) : null}
                          <span className="truncate font-semibold">
                            {calendar.summary ?? calendar.google_calendar_id}
                          </span>
                          {calendar.is_primary ? <Badge>principal</Badge> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {readOnly
                            ? 'Lecture seule — Google ne vous accorde pas l’écriture'
                            : 'Lecture et écriture'}
                          {calendar.last_sync_at
                            ? ` · dernière sync ${formatDayLong(
                                calendar.last_sync_at.slice(0, 10),
                              )} à ${formatTime(calendar.last_sync_at, household.timezone)}`
                            : ' · jamais synchronisé'}
                        </span>
                      </span>
                    </label>

                    {calendar.is_selected ? (
                      <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
                        <Field
                          label="Ce que le foyer voit"
                          hint="s'applique aux événements importés"
                        >
                          <Select
                            value={calendar.share_mode}
                            disabled={pendingCalendar === calendar.id}
                            onChange={(e) =>
                              updateCalendar(calendar.id, {
                                share_mode: e.target.value as GoogleShareMode,
                              })
                            }
                          >
                            <option value="details">Détails complets</option>
                            <option value="disponibilite">
                              Disponibilités seulement (« Occupé »)
                            </option>
                          </Select>
                        </Field>

                        {!readOnly ? (
                          <label className="flex items-start gap-2.5 text-sm">
                            <input
                              type="radio"
                              name="cible-ecriture"
                              checked={calendar.is_write_target}
                              disabled={pendingCalendar === calendar.id}
                              onChange={() =>
                                updateCalendar(calendar.id, { is_write_target: true })
                              }
                              className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]"
                            />
                            <span>
                              <span className="font-semibold">
                                Envoyer les événements Tribu vers ce calendrier
                              </span>
                              <span className="block text-xs text-muted">
                                Un seul calendrier peut recevoir les créations.
                              </span>
                            </span>
                          </label>
                        ) : (
                          <p className="flex items-start gap-1.5 text-xs text-muted">
                            <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            Ce calendrier est en lecture seule : Tribu n'y écrira jamais.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}

          {writable.length === 0 && calendars.length > 0 ? (
            <p className="mt-2 px-1 text-xs text-muted">
              Aucun de vos calendriers n'autorise l'écriture : la synchronisation sera
              à sens unique, de Google vers Tribu.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* --- Journal ------------------------------------------------------ */}
      {runs.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Dernières synchronisations
          </h2>
          <Card className="divide-y divide-[var(--line)] p-0">
            {runs.slice(0, 6).map((run) => (
              <div key={run.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {formatDayLong(run.started_at.slice(0, 10))} à{' '}
                    {formatTime(run.started_at, household.timezone)}
                  </p>
                  <Badge tone={run.status === 'succes' ? 'sage' : run.status === 'echec' ? 'alert' : 'neutral'}>
                    {run.status === 'succes'
                      ? 'Réussie'
                      : run.status === 'echec'
                        ? 'Échec'
                        : 'En cours'}
                  </Badge>
                </div>
                <p className="text-xs text-muted">
                  {run.status === 'echec'
                    ? run.error_message
                    : `${run.imported_count} importé(s), ${run.updated_count} mis à jour, ${run.exported_count} envoyé(s), ${run.deleted_count} supprimé(s)`}
                </p>
              </div>
            ))}
          </Card>
        </section>
      ) : lastRun === null && account?.calendar_authorized ? (
        <p className="px-1 text-sm text-muted">
          Aucune synchronisation n'a encore été lancée.
        </p>
      ) : null}

      {/* --- Déconnexion --------------------------------------------------- */}
      <Sheet
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Déconnecter Google Agenda ?"
        footer={
          <div className="flex gap-2 pb-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmDisconnect(false)}
              disabled={disconnecting}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={disconnect}
              loading={disconnecting}
            >
              Déconnecter
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            L'autorisation sera révoquée auprès de Google et les jetons effacés.
            <strong className="block text-[var(--fg)]">
              Par défaut, les événements déjà importés restent dans votre foyer.
            </strong>
          </p>

          <label className="flex items-start gap-2.5 rounded-2xl bg-alert-100 p-3 text-sm text-alert-700">
            <input
              type="checkbox"
              checked={removeEvents}
              onChange={(e) => setRemoveEvents(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-alert-500)]"
            />
            <span>
              Supprimer aussi les événements importés de Google.
              <span className="block text-xs">
                Les événements créés dans Tribu ne sont jamais supprimés.
              </span>
            </span>
          </label>
        </div>
      </Sheet>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Link
        href="/plus"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Plus
      </Link>
      <h1 className="mb-4 text-xl font-extrabold tracking-tight">Google Agenda</h1>
      {children}
    </div>
  );
}

/**
 * Ce qu'il reste à configurer.
 *
 * Affiché tel quel plutôt qu'un message vague : chaque ligne manquante
 * correspond à une variable d'environnement précise.
 */
function SetupChecklist({
  configured,
  encryptionConfigured,
  serviceKeyPresent,
}: {
  configured: boolean;
  encryptionConfigured: boolean;
  serviceKeyPresent: boolean;
}) {
  const items = [
    {
      done: configured,
      label: 'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET',
      hint: 'Console Google Cloud → Identifiants → ID client OAuth (application Web)',
    },
    {
      done: encryptionConfigured,
      label: 'TOKEN_ENCRYPTION_KEY',
      hint: 'Générer avec : openssl rand -base64 32',
    },
    {
      done: serviceKeyPresent,
      label: 'SUPABASE_SERVICE_ROLE_KEY',
      hint: 'Dashboard Supabase → Project Settings → API keys',
    },
  ];

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <AlertTriangle className="h-4.5 w-4.5 text-honey-700" aria-hidden />
        Configuration à terminer
      </h2>
      <p className="mb-3 text-sm text-muted">
        Tant que ces valeurs manquent, aucune synchronisation n'est possible — et
        aucune n'est simulée.
      </p>

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2.5 text-sm">
            <span
              className={cn(
                'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold',
                item.done
                  ? 'bg-sage-500 text-white'
                  : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
              )}
            >
              {item.done ? '✓' : '·'}
            </span>
            <span className="min-w-0">
              <code className="font-semibold">{item.label}</code>
              <span className="block text-xs text-muted">{item.hint}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted">
        Marche à suivre complète dans <code className="font-semibold">docs/GOOGLE.md</code>.
      </p>
    </Card>
  );
}
