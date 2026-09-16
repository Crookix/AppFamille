import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getActiveHousehold, getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  EMPTY_TOTALS,
  googleSyncReadiness,
  syncCalendars,
  totalsOf,
} from '@/lib/google/run';
import { isStale } from '@/lib/google/schedule';

/** Une campagne peut prendre du temps : on laisse de la marge à la fonction. */
export const maxDuration = 60;

/**
 * Seule forme de corps acceptée.
 *
 * `ifStaleMinutes` sert à la synchronisation déclenchée à l'ouverture d'un
 * écran : le navigateur demande « synchronise si ça date de plus de N
 * minutes », et c'est le serveur qui tranche. Mettre cette décision côté
 * navigateur aurait donné autant de politiques que d'onglets ouverts.
 */
const optionsSchema = z.object({
  ifStaleMinutes: z.number().int().min(0).max(1440).optional(),
});

/**
 * Lance une synchronisation des calendriers sélectionnés.
 *
 * Aucune synchronisation n'est simulée : si la configuration manque ou si
 * Google refuse, la réponse le dit explicitement et l'interface affiche
 * l'erreur telle quelle.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  }

  const active = await getActiveHousehold();
  if (!active) {
    return NextResponse.json({ error: 'Aucun foyer actif.' }, { status: 400 });
  }

  // Le bouton « Synchroniser » n'envoie rien du tout : un corps absent ou
  // illisible vaut « synchronise maintenant », sans condition.
  let options: z.infer<typeof optionsSchema> = {};
  try {
    const parsed = optionsSchema.safeParse(await request.json());
    if (parsed.success) options = parsed.data;
  } catch {
    /* corps vide : comportement par défaut */
  }

  const readiness = googleSyncReadiness();
  if (!readiness.ok) {
    return NextResponse.json({ error: readiness.error }, { status: 503 });
  }

  const supabase = await createClient();

  const { data: account } = await supabase
    .from('google_accounts')
    .select('id, calendar_authorized')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account || !account.calendar_authorized) {
    return NextResponse.json(
      { error: "Aucun agenda Google autorisé pour ce compte." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: calendars } = await admin
    .from('google_calendars')
    .select('*')
    .eq('google_account_id', account.id)
    .eq('household_id', active.household.id)
    .eq('is_selected', true);

  if (!calendars || calendars.length === 0) {
    return NextResponse.json(
      { error: "Aucun calendrier sélectionné. Choisissez au moins un calendrier." },
      { status: 400 },
    );
  }

  const now = new Date();
  const staleAfter = options.ifStaleMinutes;
  const due =
    staleAfter === undefined
      ? calendars
      : calendars.filter((calendar) => isStale(calendar.last_sync_at, now, staleAfter));

  // Tout est déjà frais : on le dit sans rien prétendre d'autre.
  if (due.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: 'a_jour',
      outcomes: [],
      totals: EMPTY_TOTALS,
    });
  }

  const outcomes = await syncCalendars(admin, due);

  // Rien n'a été entamé alors qu'il y avait à faire : une campagne était déjà
  // en route. « Déjà à jour » serait faux, et c'est le genre de petit mensonge
  // qui fait douter de tout le reste.
  if (outcomes.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: 'en_cours',
      outcomes: [],
      totals: EMPTY_TOTALS,
    });
  }

  const failed = outcomes.filter((o) => o.status === 'echec');

  return NextResponse.json(
    {
      ok: failed.length === 0,
      skipped: false,
      outcomes,
      totals: totalsOf(outcomes),
    },
    { status: failed.length === outcomes.length && failed.length > 0 ? 502 : 200 },
  );
}
