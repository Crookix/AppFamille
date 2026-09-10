-- ---------------------------------------------------------------------------
-- 0011 — Index de clés étrangères et fusion de politiques redondantes
--
-- Deux corrections issues des conseillers Supabase (« database linter »),
-- toutes deux de performance, aucune ne change qui voit quoi.
--
-- 1. Clés étrangères sans index couvrant.
--    Postgres n'indexe pas automatiquement le côté « enfant » d'une clé
--    étrangère. Deux conséquences : les jointures d'affichage font des
--    parcours séquentiels, et surtout la suppression d'une ligne parente
--    (supprimer un foyer, un membre, une recette) oblige Postgres à
--    parcourir toute la table enfant pour vérifier la cascade.
--
--    On n'indexe pas les 32 clés signalées : un index inutile coûte à chaque
--    écriture. Sont retenues celles qui sont réellement filtrées ou jointes
--    par l'application, plus toutes les `household_id` — puisque la totalité
--    des requêtes du produit commence par « dans ce foyer ».
--
-- 2. Politiques permissives multiples.
--    Deux politiques sur le même rôle et la même action obligent Postgres à
--    évaluer les deux. Elles sont fusionnées en une seule avec un OR, ce qui
--    donne exactement le même résultat pour une seule évaluation.
--
--    Attention : la fusion ne touche PAS le garde-fou d'élévation de rôle.
--    Celui-ci est un déclencheur BEFORE UPDATE (`guard_household_member_update`),
--    volontairement séparé, parce qu'une clause WITH CHECK ne voit que la
--    nouvelle ligne et ne peut donc pas comparer l'ancien rôle au nouveau.
-- ---------------------------------------------------------------------------

/* -- 1. Index de clés étrangères ------------------------------------------ */

-- `household_id` : la colonne de tous les filtres, et de toutes les cascades.
create index if not exists event_reminders_household_idx
  on public.event_reminders (household_id);
create index if not exists nanny_rates_household_idx
  on public.nanny_rates (household_id);
create index if not exists notifications_household_idx
  on public.notifications (household_id);

-- Jointures d'affichage réellement empruntées par les écrans.
create index if not exists event_participants_member_idx
  on public.event_participants (member_id);
create index if not exists event_participants_child_idx
  on public.event_participants (child_id);
create index if not exists meal_participants_member_idx
  on public.meal_participants (member_id);
create index if not exists meal_participants_child_idx
  on public.meal_participants (child_id);
create index if not exists childcare_session_children_child_idx
  on public.childcare_session_children (child_id);
create index if not exists meals_recipe_idx
  on public.meals (recipe_id);
create index if not exists tasks_child_idx
  on public.tasks (child_id);

-- Suppression d'un membre : ces colonnes pointent vers `household_members`,
-- et sans index chaque retrait de membre parcourt les tables concernées.
create index if not exists events_responsible_member_idx
  on public.events (responsible_member_id);
create index if not exists events_dropoff_member_idx
  on public.events (dropoff_member_id);
create index if not exists events_pickup_member_idx
  on public.events (pickup_member_id);

-- Calendriers Google : la synchronisation lit les exécutions par calendrier.
create index if not exists google_sync_runs_calendar_idx
  on public.google_sync_runs (google_calendar_ref);

/* -- 2. Fusion des politiques permissives multiples ----------------------- */

-- `household_members` en UPDATE : « je modifie ma fiche » OU « je suis
-- administrateur du foyer ». Le déclencheur reste seul juge des rôles.
drop policy if exists "membres: administrer"     on public.household_members;
drop policy if exists "membres: modifier ma fiche" on public.household_members;

create policy "membres: modifier"
  on public.household_members
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_household_admin(household_id)
  )
  with check (
    user_id = (select auth.uid())
    or public.is_household_admin(household_id)
  );

-- `profiles` en SELECT : « mon profil » OU « le profil de quelqu'un qui
-- partage un de mes foyers ». Rien d'autre n'est lisible.
drop policy if exists "profiles: lire ceux du foyer" on public.profiles;
drop policy if exists "profiles: lire le sien"       on public.profiles;

create policy "profiles: lire"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.household_members theirs
      where theirs.user_id = profiles.id
        and public.is_household_member(theirs.household_id)
    )
  );
