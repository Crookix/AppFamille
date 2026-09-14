-- ===========================================================================
-- Vérification d'étanchéité de l'espace nounou
-- ===========================================================================
--
-- La migration 0014 ouvre un accès à quelqu'un qui n'est PAS membre du foyer.
-- C'est la première fois qu'un tel accès existe, et c'est donc la première
-- fois qu'une politique trop large exposerait des données à un tiers.
--
-- Ce script le vérifie contre Postgres lui-même, pas contre du code
-- applicatif : il se fait passer pour une nounou connectée
-- (`set local role authenticated` + `request.jwt.claims`), exactement comme
-- PostgREST le fait pour une requête venue du navigateur.
--
-- Comment le lire
-- ---------------
--   OK      — la tentative a bien été bloquée, ou le témoin a bien fonctionné
--   FAILLE  — une tentative interdite a réussi ; il y a un trou dans les règles
--
-- Les lignes « TÉMOIN » sont indispensables : sans elles, une session cassée
-- renverrait zéro partout et l'on conclurait à tort que tout est étanche.
--
-- Comment l'exécuter
-- ------------------
--   psql "$DATABASE_URL" -f supabase/tests/nanny-isolation.sql
--
-- Le script crée ses propres données de test et les supprime en sortant.
-- ===========================================================================

begin;

create temporary table _t (cle text primary key, valeur text) on commit drop;
create temporary table _r (
  ordre serial,
  domaine text,
  tentative text,
  observe text,
  verdict text
) on commit drop;

grant select on _t to authenticated;
grant select, insert on _r to authenticated;
grant usage on sequence _r_ordre_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Montage : un foyer, deux nounous, deux enfants, et des données de toutes
-- les familles de tables que la nounou ne doit jamais voir.
-- ---------------------------------------------------------------------------

do $$
declare
  v_parent  text := gen_random_uuid()::text;
  v_sam     text := gen_random_uuid()::text;  -- nounou reliée
  v_foyer   uuid;
  v_membre  uuid;
  v_sam_id  uuid;
  v_bo_id   uuid;
  v_leo     uuid;  -- enfant gardé par Sam
  v_mia     uuid;  -- enfant que Sam ne garde pas
  v_garde   uuid;
  v_garde_bo uuid;
  v_event   uuid;
  v_liste   uuid;
  v_token   text := 'jeton-de-test-' || gen_random_uuid()::text;
begin
  insert into public.profiles (id, full_name)
  values (v_parent, 'Parent'), (v_sam, 'Sam');

  insert into public.households (name, timezone, created_by)
  values ('Foyer de vérification', 'Europe/Paris', v_parent)
  returning id into v_foyer;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_foyer, v_parent, 'admin', 'Parent')
  returning id into v_membre;

  insert into public.children (household_id, first_name)
  values (v_foyer, 'Léo') returning id into v_leo;
  insert into public.children (household_id, first_name)
  values (v_foyer, 'Mia') returning id into v_mia;

  insert into public.nannies (household_id, name)
  values (v_foyer, 'Sam') returning id into v_sam_id;
  insert into public.nannies (household_id, name)
  values (v_foyer, 'Bo') returning id into v_bo_id;

  -- Données que la nounou ne doit jamais voir.
  insert into public.events (household_id, title, starts_at, ends_at, timezone, created_by)
  values (v_foyer, 'Rendez-vous médical', now(), now() + interval '1 hour', 'Europe/Paris', v_parent)
  returning id into v_event;

  insert into public.tasks (household_id, title, created_by)
  values (v_foyer, 'Payer la cantine', v_parent);

  insert into public.shopping_lists (household_id, name, created_by)
  values (v_foyer, 'Courses', v_parent) returning id into v_liste;
  insert into public.shopping_items (household_id, list_id, label, label_key, created_by)
  values (v_foyer, v_liste, 'Lait', 'lait', v_parent);

  insert into public.meals (household_id, meal_date, slot, title, created_by)
  values (v_foyer, current_date, 'diner', 'Gratin', v_parent);

  -- Une garde pour Sam, une pour Bo.
  insert into public.childcare_sessions
    (household_id, nanny_id, scheduled_start, scheduled_end, applied_hourly_rate, created_by)
  values (v_foyer, v_sam_id, now() + interval '1 day', now() + interval '1 day 3 hours', 12.00, null)
  returning id into v_garde;

  insert into public.childcare_sessions
    (household_id, nanny_id, scheduled_start, scheduled_end, applied_hourly_rate, created_by)
  values (v_foyer, v_bo_id, now() + interval '2 days', now() + interval '2 days 3 hours', 13.00, null)
  returning id into v_garde_bo;

  -- Sam garde Léo, pas Mia.
  insert into public.childcare_session_children (household_id, session_id, child_id)
  values (v_foyer, v_garde, v_leo);
  insert into public.childcare_session_children (household_id, session_id, child_id)
  values (v_foyer, v_garde_bo, v_mia);

  -- L'accès de Sam, accepté.
  insert into public.nanny_accesses
    (household_id, nanny_id, email, token_hash, expires_at, invited_by, user_id, accepted_at)
  values (
    v_foyer, v_sam_id, 'sam@exemple.test',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days', v_membre, v_sam, now()
  );

  insert into _t values
    ('parent', v_parent), ('sam', v_sam), ('foyer', v_foyer::text),
    ('sam_id', v_sam_id::text), ('bo_id', v_bo_id::text),
    ('garde', v_garde::text), ('garde_bo', v_garde_bo::text),
    ('leo', v_leo::text), ('mia', v_mia::text), ('event', v_event::text);
end $$;

-- ---------------------------------------------------------------------------
-- Ce que voit la nounou Sam
-- ---------------------------------------------------------------------------

do $$
declare
  v_sam  text := (select valeur from _t where cle = 'sam');
  v_n    integer;
  v_err  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sam, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- TÉMOIN : elle voit bien sa garde. Sans cette ligne, des zéros partout
  -- ne prouveraient rien.
  select count(*) into v_n from public.childcare_sessions;
  insert into _r (domaine, tentative, observe, verdict) values
    ('gardes', 'TÉMOIN — Sam voit ses propres gardes', v_n || ' ligne(s)',
     case when v_n = 1 then 'OK' else 'FAILLE' end);

  -- Et uniquement les siennes.
  select count(*) into v_n from public.childcare_sessions
   where nanny_id = (select valeur from _t where cle = 'bo_id')::uuid;
  insert into _r (domaine, tentative, observe, verdict) values
    ('gardes', 'Lire les gardes d''une autre nounou', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.events;
  insert into _r (domaine, tentative, observe, verdict) values
    ('calendrier', 'Lire les événements du foyer', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.tasks;
  insert into _r (domaine, tentative, observe, verdict) values
    ('tâches', 'Lire les tâches du foyer', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.shopping_items;
  insert into _r (domaine, tentative, observe, verdict) values
    ('courses', 'Lire la liste de courses', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.meals;
  insert into _r (domaine, tentative, observe, verdict) values
    ('repas', 'Lire les repas planifiés', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.household_members;
  insert into _r (domaine, tentative, observe, verdict) values
    ('foyer', 'Lire la liste des membres', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.notifications;
  insert into _r (domaine, tentative, observe, verdict) values
    ('notifications', 'Lire les notifications du foyer', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  -- TÉMOIN : l'enfant qu'elle garde, et lui seul.
  select count(*) into v_n from public.children
   where id = (select valeur from _t where cle = 'leo')::uuid;
  insert into _r (domaine, tentative, observe, verdict) values
    ('enfants', 'TÉMOIN — lire l''enfant qu''elle garde', v_n || ' ligne(s)',
     case when v_n = 1 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.children
   where id = (select valeur from _t where cle = 'mia')::uuid;
  insert into _r (domaine, tentative, observe, verdict) values
    ('enfants', 'Lire un enfant qu''elle ne garde pas', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  -- TÉMOIN : sa fiche. Puis celle de sa collègue.
  select count(*) into v_n from public.nannies
   where id = (select valeur from _t where cle = 'sam_id')::uuid;
  insert into _r (domaine, tentative, observe, verdict) values
    ('nounous', 'TÉMOIN — lire sa propre fiche', v_n || ' ligne(s)',
     case when v_n = 1 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.nannies
   where id = (select valeur from _t where cle = 'bo_id')::uuid;
  insert into _r (domaine, tentative, observe, verdict) values
    ('nounous', 'Lire la fiche d''une autre nounou', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  -- Écriture : la garde ne lui appartient pas.
  update public.childcare_sessions
     set applied_hourly_rate = 99.00
   where id = (select valeur from _t where cle = 'garde')::uuid;
  get diagnostics v_n = row_count;
  insert into _r (domaine, tentative, observe, verdict) values
    ('gardes', 'Modifier le tarif de sa propre garde', v_n || ' ligne(s) modifiée(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Déclarations d'heures et indisponibilités
-- ---------------------------------------------------------------------------

do $$
declare
  v_sam    text := (select valeur from _t where cle = 'sam');
  v_foyer  uuid := (select valeur from _t where cle = 'foyer')::uuid;
  v_sam_id uuid := (select valeur from _t where cle = 'sam_id')::uuid;
  v_bo_id  uuid := (select valeur from _t where cle = 'bo_id')::uuid;
  v_garde  uuid := (select valeur from _t where cle = 'garde')::uuid;
  v_garde_bo uuid := (select valeur from _t where cle = 'garde_bo')::uuid;
  v_n      integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sam, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- TÉMOIN : elle déclare ses heures sur SA garde.
  begin
    insert into public.childcare_declarations
      (household_id, session_id, nanny_id, declared_start, declared_end)
    values (v_foyer, v_garde, v_sam_id, now(), now() + interval '3 hours');
    insert into _r (domaine, tentative, observe, verdict) values
      ('déclarations', 'TÉMOIN — déclarer ses heures sur sa garde', 'acceptée', 'OK');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict) values
      ('déclarations', 'TÉMOIN — déclarer ses heures sur sa garde', sqlerrm, 'FAILLE');
  end;

  -- Sur la garde d'une autre : refusé.
  begin
    insert into public.childcare_declarations
      (household_id, session_id, nanny_id, declared_start, declared_end)
    values (v_foyer, v_garde_bo, v_bo_id, now(), now() + interval '3 hours');
    insert into _r (domaine, tentative, observe, verdict) values
      ('déclarations', 'Déclarer sur la garde d''une autre nounou', 'acceptée', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict) values
      ('déclarations', 'Déclarer sur la garde d''une autre nounou', 'refusée', 'OK');
  end;

  -- S'accepter sa propre déclaration : refusé. La clause WITH CHECK lève une
  -- erreur au lieu de ne modifier aucune ligne — c'est un refus tout aussi
  -- ferme, mais il se constate autrement.
  begin
    update public.childcare_declarations
       set status = 'acceptee'
     where session_id = v_garde;
    get diagnostics v_n = row_count;
    insert into _r (domaine, tentative, observe, verdict) values
      ('déclarations', 'Valider sa propre déclaration', v_n || ' ligne(s) modifiée(s)',
       case when v_n = 0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict) values
      ('déclarations', 'Valider sa propre déclaration', 'refusée par la RLS', 'OK');
  end;

  -- TÉMOIN : elle pose une indisponibilité pour elle.
  begin
    insert into public.nanny_availability (household_id, nanny_id, starts_at, ends_at)
    values (v_foyer, v_sam_id, now() + interval '5 days', now() + interval '6 days');
    insert into _r (domaine, tentative, observe, verdict) values
      ('indispos', 'TÉMOIN — poser sa propre indisponibilité', 'acceptée', 'OK');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict) values
      ('indispos', 'TÉMOIN — poser sa propre indisponibilité', sqlerrm, 'FAILLE');
  end;

  -- Au nom d'une autre : refusé.
  begin
    insert into public.nanny_availability (household_id, nanny_id, starts_at, ends_at)
    values (v_foyer, v_bo_id, now() + interval '5 days', now() + interval '6 days');
    insert into _r (domaine, tentative, observe, verdict) values
      ('indispos', 'Poser une indisponibilité au nom d''une autre', 'acceptée', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict) values
      ('indispos', 'Poser une indisponibilité au nom d''une autre', 'refusée', 'OK');
  end;

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Le foyer, lui, voit tout ce qui le concerne
-- ---------------------------------------------------------------------------

do $$
declare
  v_parent text := (select valeur from _t where cle = 'parent');
  v_n integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_parent, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.childcare_declarations;
  insert into _r (domaine, tentative, observe, verdict) values
    ('foyer', 'TÉMOIN — le foyer lit les déclarations', v_n || ' ligne(s)',
     case when v_n >= 1 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.nanny_availability;
  insert into _r (domaine, tentative, observe, verdict) values
    ('foyer', 'TÉMOIN — le foyer lit les indisponibilités', v_n || ' ligne(s)',
     case when v_n >= 1 then 'OK' else 'FAILLE' end);

  update public.childcare_declarations set status = 'acceptee';
  get diagnostics v_n = row_count;
  insert into _r (domaine, tentative, observe, verdict) values
    ('foyer', 'TÉMOIN — le foyer valide une déclaration', v_n || ' ligne(s) modifiée(s)',
     case when v_n >= 1 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.childcare_sessions;
  insert into _r (domaine, tentative, observe, verdict) values
    ('foyer', 'TÉMOIN — le foyer voit toutes les gardes', v_n || ' ligne(s)',
     case when v_n = 2 then 'OK' else 'FAILLE' end);

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Un accès révoqué ne donne plus rien
-- ---------------------------------------------------------------------------

do $$
declare
  v_sam text := (select valeur from _t where cle = 'sam');
  v_n   integer;
begin
  update public.nanny_accesses set revoked_at = now() where user_id = v_sam;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sam, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.childcare_sessions;
  insert into _r (domaine, tentative, observe, verdict) values
    ('révocation', 'Lire ses gardes après révocation', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.children;
  insert into _r (domaine, tentative, observe, verdict) values
    ('révocation', 'Lire les enfants après révocation', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.households;
  insert into _r (domaine, tentative, observe, verdict) values
    ('révocation', 'Lire le foyer après révocation', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Une personne connectée, sans aucun lien, ne voit rien
-- ---------------------------------------------------------------------------

do $$
declare
  v_intrus text := gen_random_uuid()::text;
  v_n integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_intrus, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.childcare_sessions;
  insert into _r (domaine, tentative, observe, verdict) values
    ('inconnu', 'Lire les gardes sans aucun lien', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.nanny_availability;
  insert into _r (domaine, tentative, observe, verdict) values
    ('inconnu', 'Lire les indisponibilités sans aucun lien', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  select count(*) into v_n from public.childcare_declarations;
  insert into _r (domaine, tentative, observe, verdict) values
    ('inconnu', 'Lire les déclarations sans aucun lien', v_n || ' ligne(s)',
     case when v_n = 0 then 'OK' else 'FAILLE' end);

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Verdict
-- ---------------------------------------------------------------------------

select ordre, domaine, tentative, observe, verdict from _r order by ordre;

select
  count(*) filter (where verdict = 'OK')     as conformes,
  count(*) filter (where verdict = 'FAILLE') as failles,
  count(*)                                   as total
from _r;

rollback;
