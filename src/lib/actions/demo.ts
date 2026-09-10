'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ACTIVE_HOUSEHOLD_COOKIE, getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { guessAisle, normalizeLabel } from '@/lib/ingredients';
import { fail, ok } from './_helpers';

/**
 * Foyer de démonstration.
 *
 * Créé au nom de l'utilisateur connecté, avec ses droits ordinaires : la RLS
 * s'applique exactement comme pour un vrai foyer, aucun privilège élevé n'est
 * emprunté. Ce n'est donc pas une maquette, mais un foyer réel — simplement
 * marqué `is_demo` et supprimable d'un geste.
 *
 * Contenu : deux adultes (le second reste à inviter, un compte ne pouvant pas
 * être fabriqué à sa place), deux enfants, une nounou et une semaine
 * cohérente.
 */
export async function loadDemoHouseholdAction() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO !== '1') {
    return fail("Le mode démonstration n'est pas activé sur cette installation.");
  }

  const user = await getUser();
  if (!user) return fail('Connexion requise.');

  const supabase = await createClient();

  const { data: householdId, error: createError } = await supabase.rpc(
    'create_household',
    {
      p_name: 'Foyer de démonstration',
      p_display_name: 'Camille',
      p_timezone: 'Europe/Paris',
    },
  );

  if (createError || !householdId) {
    return fail(createError?.message ?? "Le foyer de démonstration n'a pas pu être créé.");
  }

  await supabase.from('households').update({ is_demo: true }).eq('id', householdId);

  const { data: meMember } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('user_id', user.id)
    .single();

  const meId = meMember!.id;

  /* --- Repères de temps : la semaine en cours --------------------------- */
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const day = (offset: number) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    return date.toISOString().slice(0, 10);
  };

  const at = (offset: number, hours: number, minutes = 0) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  };

  /* --- Enfants ---------------------------------------------------------- */
  const { data: children } = await supabase
    .from('children')
    .insert([
      {
        household_id: householdId,
        first_name: 'Léa',
        birth_date: `${today.getFullYear() - 8}-04-12`,
        color: 'sauge',
        school_name: 'École Jules-Ferry',
        school_contact: 'Secrétariat 01 23 45 67 89',
        allergies: 'Arachides',
        notes: 'A besoin de son doudou pour la sieste.',
      },
      {
        household_id: householdId,
        first_name: 'Noé',
        birth_date: `${today.getFullYear() - 4}-11-03`,
        color: 'miel',
        school_name: 'Crèche Les Petits Pas',
      },
    ])
    .select('id, first_name');

  const lea = children?.find((c) => c.first_name === 'Léa')?.id ?? null;
  const noe = children?.find((c) => c.first_name === 'Noé')?.id ?? null;

  if (lea) {
    await supabase.from('child_activities').insert([
      {
        household_id: householdId,
        child_id: lea,
        label: 'Piscine',
        weekday: 3,
        start_time: '17:00',
        end_time: '18:00',
        location: 'Piscine municipale',
      },
    ]);
  }

  /* --- Événements de la semaine ----------------------------------------- */
  const { data: events } = await supabase
    .from('events')
    .insert([
      {
        household_id: householdId,
        title: 'Réunion parents-professeurs',
        description: 'Apporter le carnet de correspondance.',
        category: 'ecole' as const,
        starts_at: at(1, 18, 0),
        ends_at: at(1, 19, 0),
        timezone: 'Europe/Paris',
        location: 'École Jules-Ferry',
        address: "12 rue des Lilas, Lyon",
        responsible_member_id: meId,
        created_by: user.id,
      },
      {
        household_id: householdId,
        title: 'Piscine de Léa',
        category: 'activite' as const,
        starts_at: at(2, 17, 0),
        ends_at: at(2, 18, 0),
        timezone: 'Europe/Paris',
        location: 'Piscine municipale',
        recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE',
        dropoff_member_id: meId,
        pickup_member_id: meId,
        created_by: user.id,
      },
      {
        household_id: householdId,
        title: 'Pédiatre — Noé',
        category: 'sante' as const,
        starts_at: at(4, 9, 30),
        ends_at: at(4, 10, 15),
        timezone: 'Europe/Paris',
        location: 'Cabinet du Dr Martin',
        responsible_member_id: meId,
        created_by: user.id,
      },
      {
        household_id: householdId,
        title: 'Week-end chez les grands-parents',
        category: 'voyage' as const,
        kind: 'deplacement' as const,
        starts_at: at(5, 8, 30),
        ends_at: at(6, 19, 0),
        timezone: 'Europe/Paris',
        created_by: user.id,
      },
    ])
    .select('id, title, kind');

  const trip = events?.find((e) => e.kind === 'deplacement');
  const swim = events?.find((e) => e.title === 'Piscine de Léa');
  const school = events?.find((e) => e.title.startsWith('Réunion'));
  const doctor = events?.find((e) => e.title.startsWith('Pédiatre'));

  if (trip) {
    await supabase.from('trip_details').insert({
      event_id: trip.id,
      household_id: householdId,
      transport_mode: 'train' as const,
      departure_place: 'Paris Gare de Lyon',
      departure_at: at(5, 8, 30),
      departure_tz: 'Europe/Paris',
      arrival_place: 'Marseille Saint-Charles',
      arrival_at: at(5, 11, 45),
      arrival_tz: 'Europe/Paris',
      carrier_number: 'TGV 6173',
      booking_ref: 'XKPT29',
      seat_info: 'Voiture 12, places 41 à 44',
    });
  }

  const participants: {
    household_id: string;
    event_id: string;
    member_id?: string | null;
    child_id?: string | null;
  }[] = [];

  if (swim && lea) participants.push({ household_id: householdId, event_id: swim.id, child_id: lea });
  if (doctor && noe) participants.push({ household_id: householdId, event_id: doctor.id, child_id: noe });
  if (school && lea) participants.push({ household_id: householdId, event_id: school.id, child_id: lea });
  if (trip) {
    participants.push({ household_id: householdId, event_id: trip.id, member_id: meId });
    if (lea) participants.push({ household_id: householdId, event_id: trip.id, child_id: lea });
    if (noe) participants.push({ household_id: householdId, event_id: trip.id, child_id: noe });
  }
  if (participants.length > 0) {
    await supabase.from('event_participants').insert(participants);
  }

  /* --- Tâches ------------------------------------------------------------ */
  await supabase.from('tasks').insert([
    {
      household_id: householdId,
      title: 'Préparer la valise des enfants',
      assignee_id: meId,
      due_date: day(4),
      priority: 'haute' as const,
      event_id: trip?.id ?? null,
      created_by: user.id,
    },
    {
      household_id: householdId,
      title: 'Sortir les poubelles',
      due_date: day(1),
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU',
      created_by: user.id,
    },
    {
      household_id: householdId,
      title: 'Prendre rendez-vous chez le dentiste',
      priority: 'normale' as const,
      child_id: lea,
      created_by: user.id,
    },
    {
      household_id: householdId,
      title: 'Rendre les livres à la bibliothèque',
      due_date: day(-2),
      assignee_id: meId,
      created_by: user.id,
    },
  ]);

  /* --- Recettes et repas -------------------------------------------------- */
  const { data: recipes } = await supabase
    .from('recipes')
    .insert([
      {
        household_id: householdId,
        name: 'Gratin de courgettes',
        servings: 4,
        steps: '1. Préchauffer le four à 180 °C.\n2. Émincer les courgettes.\n3. Enfourner 35 min.',
        is_favorite: true,
        created_by: user.id,
      },
      {
        household_id: householdId,
        name: 'Pâtes à la bolognaise',
        servings: 4,
        created_by: user.id,
      },
    ])
    .select('id, name');

  const gratin = recipes?.find((r) => r.name.startsWith('Gratin'))?.id;
  const bolo = recipes?.find((r) => r.name.startsWith('Pâtes'))?.id;

  const ingredient = (
    recipeId: string,
    label: string,
    quantity: number | null,
    unit: string | null,
    position: number,
  ) => ({
    household_id: householdId,
    recipe_id: recipeId,
    label,
    label_key: normalizeLabel(label),
    quantity,
    unit,
    aisle: guessAisle(label),
    position,
  });

  if (gratin && bolo) {
    await supabase.from('recipe_ingredients').insert([
      ingredient(gratin, 'Courgettes', 800, 'g', 0),
      ingredient(gratin, 'Crème fraîche', 20, 'cl', 1),
      ingredient(gratin, 'Gruyère râpé', 100, 'g', 2),
      ingredient(gratin, 'Œufs', 3, null, 3),
      // Les tomates apparaissent dans les deux recettes : la génération des
      // courses les regroupera, ce qui rend la démonstration parlante.
      ingredient(bolo, 'Tomates', 400, 'g', 0),
      ingredient(bolo, 'Bœuf haché', 500, 'g', 1),
      ingredient(bolo, 'Pâtes', 500, 'g', 2),
      ingredient(bolo, 'Oignons', 2, null, 3),
    ]);
  }

  await supabase.from('meals').insert([
    {
      household_id: householdId,
      meal_date: day(0),
      slot: 'diner' as const,
      title: 'Gratin de courgettes',
      recipe_id: gratin ?? null,
      servings: 4,
      created_by: user.id,
    },
    {
      household_id: householdId,
      meal_date: day(1),
      slot: 'diner' as const,
      title: 'Pâtes à la bolognaise',
      recipe_id: bolo ?? null,
      servings: 4,
      created_by: user.id,
    },
    {
      household_id: householdId,
      meal_date: day(2),
      slot: 'diner' as const,
      title: 'Soupe et tartines',
      created_by: user.id,
    },
    {
      household_id: householdId,
      meal_date: day(3),
      slot: 'diner' as const,
      title: 'Restes du mardi',
      created_by: user.id,
    },
  ]);

  /* --- Courses ------------------------------------------------------------ */
  const { data: list } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('household_id', householdId)
    .eq('is_default', true)
    .single();

  if (list) {
    const item = (
      label: string,
      quantity: number | null,
      unit: string | null,
      checked = false,
    ) => ({
      household_id: householdId,
      list_id: list.id,
      label,
      label_key: normalizeLabel(label),
      quantity,
      unit,
      aisle: guessAisle(label),
      is_checked: checked,
      created_by: user.id,
    });

    await supabase
      .from('shopping_items')
      .insert([
        item('Lait', 2, 'L'),
        item('Pain', 1, null),
        item('Pommes', 1, 'kg'),
        item('Papier toilette', 1, 'paquet'),
        item('Café', 1, 'paquet', true),
      ]);
  }

  /* --- Nounou et gardes ---------------------------------------------------- */
  const { data: nanny } = await supabase
    .from('nannies')
    .insert({
      household_id: householdId,
      name: 'Sofia',
      phone: '06 12 34 56 78',
      color: 'lavande',
      notes: 'Disponible les mardis et jeudis soir.',
    })
    .select('id')
    .single();

  if (nanny) {
    // Deux tarifs : l'ancien s'applique à la garde passée, le nouveau aux
    // gardes à venir. C'est la démonstration que changer le tarif ne rejoue
    // pas les bilans.
    const lastYear = `${today.getFullYear() - 1}-01-01`;
    await supabase.from('nanny_rates').insert([
      {
        household_id: householdId,
        nanny_id: nanny.id,
        hourly_rate: 11,
        effective_from: lastYear,
      },
      {
        household_id: householdId,
        nanny_id: nanny.id,
        hourly_rate: 12.5,
        effective_from: day(-30),
      },
    ]);

    const { data: sessions } = await supabase
      .from('childcare_sessions')
      .insert([
        // Garde passée, heures saisies et confirmées : elle alimente le bilan.
        {
          household_id: householdId,
          nanny_id: nanny.id,
          scheduled_start: at(-6, 18, 30),
          scheduled_end: at(-6, 22, 0),
          actual_start: at(-6, 18, 25),
          actual_end: at(-6, 22, 40),
          unpaid_break_minutes: 0,
          applied_hourly_rate: 12.5,
          status: 'confirmee' as const,
          location: 'À la maison',
          created_by: user.id,
        },
        // Garde passée dont les heures restent à saisir : elle fait apparaître
        // l'alerte sur l'accueil.
        {
          household_id: householdId,
          nanny_id: nanny.id,
          scheduled_start: at(-2, 19, 0),
          scheduled_end: at(-2, 23, 30),
          applied_hourly_rate: 12.5,
          status: 'prevue' as const,
          location: 'À la maison',
          created_by: user.id,
        },
        // Garde à venir, qui passe minuit.
        {
          household_id: householdId,
          nanny_id: nanny.id,
          scheduled_start: at(5, 20, 30),
          scheduled_end: at(6, 1, 15),
          applied_hourly_rate: 12.5,
          status: 'prevue' as const,
          location: 'À la maison',
          notes: 'Dîner déjà prêt au frigo.',
          created_by: user.id,
        },
      ])
      .select('id');

    if (sessions && children) {
      await supabase.from('childcare_session_children').insert(
        sessions.flatMap((session) =>
          children.map((child) => ({
            household_id: householdId,
            session_id: session.id,
            child_id: child.id,
          })),
        ),
      );

      await supabase.from('childcare_extras').insert({
        household_id: householdId,
        session_id: sessions[0].id,
        label: 'Transport',
        amount: 4.5,
      });
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  return ok({ householdId: householdId as string });
}

/** Supprime un foyer de démonstration et tout ce qu'il contient. */
export async function deleteDemoHouseholdAction(householdId: string) {
  const user = await getUser();
  if (!user) return fail('Connexion requise.');

  const supabase = await createClient();

  const { data: household } = await supabase
    .from('households')
    .select('id, is_demo')
    .eq('id', householdId)
    .maybeSingle();

  if (!household) return fail("Ce foyer n'existe plus.");

  // Garde-fou : cette action ne doit jamais pouvoir effacer un vrai foyer.
  if (!household.is_demo) {
    return fail("Ce foyer n'est pas un foyer de démonstration.");
  }

  const { error } = await supabase.from('households').delete().eq('id', householdId);
  if (error) return fail(error.message);

  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_HOUSEHOLD_COOKIE);

  revalidatePath('/', 'layout');
  return ok();
}
