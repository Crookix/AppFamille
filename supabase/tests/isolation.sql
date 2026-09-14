-- ===========================================================================
-- Vérification d'étanchéité entre foyers — à exécuter sur la base réelle
-- ===========================================================================
--
-- Le cahier des charges demande de vérifier explicitement qu'un utilisateur
-- d'un autre foyer ne peut « ni lire ni modifier les données ou télécharger
-- les pièces jointes ». Ce script le vérifie contre Postgres lui-même, pas
-- contre du code applicatif : il se fait passer pour un utilisateur connecté
-- (`set local role authenticated` + `request.jwt.claims`), exactement comme
-- PostgREST le fait pour une requête venue du navigateur. Les politiques RLS
-- s'appliquent donc à l'identique.
--
-- Comment le lire
-- ---------------
-- Chaque ligne du résultat porte un `verdict` :
--   OK    — la tentative a bien été bloquée, ou le témoin a bien fonctionné
--   FAILLE — une tentative interdite a réussi ; il y a un trou dans les règles
--
-- Les lignes « TÉMOIN » sont indispensables : sans elles, une session cassée
-- renverrait zéro partout et l'on conclurait à tort que tout est étanche.
-- Elles prouvent que les mêmes requêtes renvoient bien des lignes quand
-- l'utilisateur y a droit.
--
-- Comment l'exécuter
-- ------------------
--   psql "$DATABASE_URL" -f supabase/tests/isolation.sql
-- ou en collant le contenu dans l'éditeur SQL de Supabase.
--
-- Le script crée ses propres comptes et foyers de test, puis les supprime.
-- Il ne touche à aucune donnée existante.
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

-- Les blocs de vérification écrivent dans `_r` alors qu'ils se font passer
-- pour `authenticated` ; sans ces droits, c'est le journal du test qui
-- échouerait, pas le test lui-même.
grant select on _t to authenticated;
grant select, insert on _r to authenticated;
grant usage on sequence _r_ordre_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Montage : trois comptes, deux foyers, des données dans le foyer A
-- ---------------------------------------------------------------------------

do $$
declare
  v_camille text := gen_random_uuid()::text;
  v_alex    text := gen_random_uuid()::text;
  v_intrus  text := gen_random_uuid()::text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  select u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.email, extensions.crypt('VerifTribu!2026', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', u.nom)
  from (values
    (v_camille, 'verif.camille@myfamily.test', 'Camille'),
    (v_alex,    'verif.alex@myfamily.test',    'Alex'),
    (v_intrus,  'verif.intrus@myfamily.test',  'Intrus')
  ) as u(id, email, nom);

  insert into _t values ('camille', v_camille), ('alex', v_alex), ('intrus', v_intrus);
end $$;

-- Foyer A, monté par Camille via le RPC applicatif (donc soumis à ses règles).
do $$
declare
  v_camille text := (select valeur from _t where cle='camille');
  v_foyer_a uuid;
  v_reco_a  uuid;
  v_nounou  uuid;
  v_garde   uuid;
  v_liste_a uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_camille::text, 'role','authenticated')::text, true);
  set local role authenticated;

  select public.create_household('Foyer A (vérif)', 'Camille', 'Europe/Paris') into v_foyer_a;

  insert into public.children (household_id, first_name, allergies)
  values (v_foyer_a, 'Léa', 'Arachides');

  insert into public.events (household_id, title, description, starts_at, ends_at)
  values (v_foyer_a, 'Rendez-vous confidentiel',
          'Contenu privé qui ne doit jamais fuiter',
          now() + interval '1 day', now() + interval '1 day 1 hour');

  insert into public.tasks (household_id, title) values (v_foyer_a, 'Tâche privée');

  insert into public.recommendations
    (household_id, kind, title, note, suggested_by, created_by)
  values (v_foyer_a, 'film', 'Film que le foyer A garde pour lui',
          'Pourquoi on le recommande — contenu privé',
          public.current_member_id(v_foyer_a), v_camille)
  returning id into v_reco_a;

  insert into public.recommendation_wants (household_id, recommendation_id, member_id)
  values (v_foyer_a, v_reco_a, public.current_member_id(v_foyer_a));

  insert into public.checklists (household_id, name, note, created_by)
  values (v_foyer_a, 'La valise des enfants', 'Week-end chez les grands-parents',
          v_camille)
  returning id into v_liste_a;

  insert into public.checklist_items (household_id, checklist_id, label, position)
  values (v_foyer_a, v_liste_a, 'Doudou', 0),
         (v_foyer_a, v_liste_a, 'Pyjama', 1);

  insert into public.nannies (household_id, name) values (v_foyer_a, 'Sofia')
  returning id into v_nounou;

  -- Un second enfant, que la nounou ne garde PAS : c'est lui qui prouvera que
  -- la politique « enfants » est bien restreinte aux enfants effectivement
  -- confiés, et non ouverte à tout le foyer.
  insert into public.children (household_id, first_name) values (v_foyer_a, 'Max');

  insert into public.childcare_sessions
    (household_id, nanny_id, scheduled_start, scheduled_end, applied_hourly_rate)
  values (v_foyer_a, v_nounou, now() + interval '1 day',
          now() + interval '1 day 3 hours', 12.00)
  returning id into v_garde;

  insert into public.childcare_session_children (household_id, session_id, child_id)
  select v_foyer_a, v_garde, c.id
  from public.children c
  where c.household_id = v_foyer_a and c.first_name = 'Léa';
  insert into public.attachments (household_id, storage_path, file_name, uploaded_by)
  values (v_foyer_a, v_foyer_a::text || '/billet-prive.pdf', 'billet-prive.pdf', v_camille);

  reset role;
  insert into _t values ('foyer_a', v_foyer_a::text), ('reco_a', v_reco_a::text),
                        ('nounou', v_nounou::text), ('garde', v_garde::text),
                        ('liste_a', v_liste_a::text);
end $$;

-- Le lien d'accès de la nounou, posé hors rôle applicatif : c'est du montage,
-- pas la vérification d'une politique d'écriture.
insert into public.nanny_accesses
  (household_id, nanny_id, email, token_hash, expires_at)
values (
  (select valeur from _t where cle='foyer_a')::uuid,
  (select valeur from _t where cle='nounou')::uuid,
  'sofia@verif.test',
  encode(extensions.digest('jeton-nounou-verif', 'sha256'), 'hex'),
  now() + interval '7 days'
);

-- Un objet de stockage réel dans l'espace du foyer A.
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
select 'attachments',
       (select valeur from _t where cle='foyer_a') || '/billet-prive.pdf',
       (select valeur from _t where cle='camille')::uuid,
       (select valeur from _t where cle='camille'),
       '{"mimetype":"application/pdf","size":1024}'::jsonb;

-- Foyer B, monté par Alex. L'intrus y est un adulte SANS droits d'admin.
do $$
declare
  v_alex   text := (select valeur from _t where cle='alex');
  v_intrus text := (select valeur from _t where cle='intrus');
  v_foyer_b uuid;
  v_reco_b  uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_alex::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.create_household('Foyer B (vérif)', 'Alex', 'Europe/Paris') into v_foyer_b;

  insert into public.recommendations (household_id, kind, title, suggested_by, created_by)
  values (v_foyer_b, 'serie', 'Série du foyer B',
          public.current_member_id(v_foyer_b), v_alex)
  returning id into v_reco_b;

  reset role;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_foyer_b, v_intrus, 'adulte', 'Intrus');

  insert into _t values ('foyer_b', v_foyer_b::text), ('reco_b', v_reco_b::text);
end $$;

-- Invitations du foyer A dans les quatre états possibles.
insert into public.invitations (household_id, role, token_hash, created_at, expires_at, created_by, revoked_at, accepted_at, accepted_by)
select (select valeur from _t where cle='foyer_a')::uuid, 'adulte',
       encode(extensions.digest(i.jeton, 'sha256'), 'hex'),
       i.cree, i.expire, (select valeur from _t where cle='camille'),
       i.revoque, i.accepte,
       case when i.accepte is null then null else (select valeur from _t where cle='camille') end
from (values
  ('verif-expire',   now() - interval '10 days', now() - interval '3 days', null::timestamptz, null::timestamptz),
  ('verif-revoque',  now(), now() + interval '7 days', now(), null::timestamptz),
  ('verif-consomme', now(), now() + interval '7 days', null::timestamptz, now()),
  ('verif-valide',   now(), now() + interval '7 days', null::timestamptz, null::timestamptz)
) as i(jeton, cree, expire, revoque, accepte);

-- ---------------------------------------------------------------------------
-- Acte 1 — Alex, membre du foyer B, essaie de LIRE le foyer A
-- ---------------------------------------------------------------------------

do $$
declare
  a uuid := (select valeur from _t where cle='foyer_a')::uuid;
  b uuid := (select valeur from _t where cle='foyer_b')::uuid;
  v_alex text := (select valeur from _t where cle='alex');
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_alex::text, 'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.events where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Événements du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.children where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Enfants du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.tasks where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Tâches du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.nannies where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Nounous du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.recommendations where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Recos du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.checklists where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Check-lists du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.checklist_items where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Points de check-list du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.nanny_accesses where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Accès nounou du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.nanny_availability where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Indisponibilités nounou du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.childcare_declarations where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Déclarations d''heures du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.recommendation_wants where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Envies de reco du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.attachments where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Pièces jointes du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.households where id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Le foyer A lui-même', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.household_members where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Membres du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.invitations where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Invitations du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.google_credentials;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'Jetons Google (table entière)', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from storage.objects
    where bucket_id='attachments' and name like a::text || '/%';
  insert into _r (domaine, tentative, observe, verdict)
    values ('Pièces jointes', 'Objets de stockage du foyer A', n || ' objet(s)', case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.households where id = b;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Lecture', 'TÉMOIN — son propre foyer B', n || ' ligne(s)', case when n=1 then 'OK' else 'FAILLE' end);

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Acte 2 — Alex essaie d'ÉCRIRE dans le foyer A
-- ---------------------------------------------------------------------------

do $$
declare
  a uuid := (select valeur from _t where cle='foyer_a')::uuid;
  b uuid := (select valeur from _t where cle='foyer_b')::uuid;
  v_alex text := (select valeur from _t where cle='alex');
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_alex::text, 'role','authenticated')::text, true);
  set local role authenticated;

  begin
    update public.events set title='PIRATE' where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier un événement du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier un événement du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    delete from public.events where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Supprimer un événement du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Supprimer un événement du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    delete from public.children where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Supprimer un enfant du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Supprimer un enfant du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.tasks set title='PIRATE' where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier une tâche du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier une tâche du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.recommendations set title='PIRATE' where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier une reco du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier une reco du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  -- Une envie porte un `household_id` : sans le contrôle d'appartenance, on
  -- pourrait accrocher la sienne à la fiche d'un foyer voisin.
  begin
    insert into public.recommendation_wants (household_id, recommendation_id, member_id)
    values (a, (select valeur from _t where cle='reco_a')::uuid,
            (select id from public.household_members where household_id = b and user_id = v_alex));
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Déclarer une envie sur une reco du foyer A', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Déclarer une envie sur une reco du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.checklists set name='PIRATE' where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Renommer une check-list du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Renommer une check-list du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  -- Décocher la valise du voisin serait sans gravité, mais c'est la même
  -- politique qui protège tout le reste : elle doit tenir ici aussi.
  begin
    update public.checklist_items set is_checked = true where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Cocher un point de check-list du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Cocher un point de check-list du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.checklist_items (household_id, checklist_id, label)
    values (a, (select valeur from _t where cle='liste_a')::uuid, 'Intrusion');
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Ajouter un point à une check-list du foyer A', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Ajouter un point à une check-list du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  -- L'espace nounou ouvre un accès à quelqu'un qui n'est pas membre du foyer :
  -- raison de plus pour vérifier qu'il ne s'ouvre pas au foyer d'à côté.
  begin
    insert into public.nanny_accesses (household_id, nanny_id, token_hash, expires_at)
    values (a, (select valeur from _t where cle='nounou')::uuid,
            'faux-condensat', now() + interval '1 day');
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'S''inviter comme nounou du foyer A', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'S''inviter comme nounou du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.nannies set name='PIRATE' where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier une nounou du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Modifier une nounou du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.households set name='PIRATE' where id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Renommer le foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Renommer le foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.attachments set file_name='PIRATE.pdf' where household_id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Pièces jointes', 'Modifier une pièce jointe du foyer A', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Pièces jointes', 'Modifier une pièce jointe du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.events (household_id, title, starts_at, ends_at)
    values (a, 'Intrusion', now(), now() + interval '1 hour');
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Créer un événement dans le foyer A', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'Créer un événement dans le foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.household_members (household_id, user_id, role, display_name)
    values (a, v_alex, 'admin', 'Alex');
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'S''ajouter comme admin du foyer A', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'S''ajouter comme admin du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values ('attachments', a::text || '/intrusion.pdf', v_alex::uuid, v_alex, '{}'::jsonb);
    insert into _r (domaine, tentative, observe, verdict)
      values ('Pièces jointes', 'Déposer un fichier dans l''espace du foyer A', 'déposé', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Pièces jointes', 'Déposer un fichier dans l''espace du foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.attachments (household_id, storage_path, file_name, uploaded_by)
    values (a, a::text || '/intrusion.pdf', 'intrusion.pdf', v_alex);
    insert into _r (domaine, tentative, observe, verdict)
      values ('Pièces jointes', 'Référencer une pièce jointe dans le foyer A', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Pièces jointes', 'Référencer une pièce jointe dans le foyer A', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    update public.households set name='Foyer B (vérif) — témoin' where id = b;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'TÉMOIN — renommer son propre foyer B', n || ' ligne(s)', case when n=1 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Écriture', 'TÉMOIN — renommer son propre foyer B', 'refusé ('||sqlstate||')', 'FAILLE');
  end;

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Acte 3 — L'intrus, adulte du foyer B, essaie d'y prendre le pouvoir
-- ---------------------------------------------------------------------------

do $$
declare
  b uuid := (select valeur from _t where cle='foyer_b')::uuid;
  v_alex text := (select valeur from _t where cle='alex');
  v_intrus text := (select valeur from _t where cle='intrus');
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_intrus::text, 'role','authenticated')::text, true);
  set local role authenticated;

  begin
    update public.household_members set role='admin'
      where household_id = b and user_id = v_intrus;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte non-admin : se promouvoir admin', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte non-admin : se promouvoir admin', 'refusé : '||left(sqlerrm,60), 'OK');
  end;

  begin
    update public.household_members set display_name='PIRATE'
      where household_id = b and user_id = v_alex;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte non-admin : modifier la fiche d''un autre', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte non-admin : modifier la fiche d''un autre', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    delete from public.household_members where household_id = b and user_id = v_alex;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte non-admin : exclure l''administrateur', n || ' ligne(s)', case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte non-admin : exclure l''administrateur', 'refusé ('||sqlstate||')', 'OK');
  end;

  -- Les envies ne s'ajoutent que pour soi : la politique compare `member_id`
  -- à `current_member_id()`, sinon n'importe qui voterait à la place des autres.
  begin
    insert into public.recommendation_wants (household_id, recommendation_id, member_id)
    values (b, (select valeur from _t where cle='reco_b')::uuid,
            (select id from public.household_members where household_id = b and user_id = v_alex));
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte : déclarer une envie au nom d''un autre', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'Adulte : déclarer une envie au nom d''un autre', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.recommendation_wants (household_id, recommendation_id, member_id)
    values (b, (select valeur from _t where cle='reco_b')::uuid,
            (select id from public.household_members where household_id = b and user_id = v_intrus));
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'TÉMOIN — déclarer sa propre envie', n || ' ligne(s)', case when n=1 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'TÉMOIN — déclarer sa propre envie', 'refusé ('||sqlstate||')', 'FAILLE');
  end;

  begin
    update public.household_members set display_name='Intrus renommé'
      where household_id = b and user_id = v_intrus;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'TÉMOIN — renommer sa propre fiche', n || ' ligne(s)', case when n=1 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Élévation', 'TÉMOIN — renommer sa propre fiche', 'refusé ('||sqlstate||')', 'FAILLE');
  end;

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Acte 4 — Les invitations sont-elles vraiment limitées dans le temps ?
-- ---------------------------------------------------------------------------

do $$
declare
  v_intrus text := (select valeur from _t where cle='intrus');
  a uuid := (select valeur from _t where cle='foyer_a')::uuid;
  v_res uuid;
  v_state text;
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_intrus::text, 'role','authenticated')::text, true);
  set local role authenticated;

  begin
    select public.accept_invitation('verif-expire') into v_res;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Accepter un lien EXPIRÉ', 'accepté', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Accepter un lien EXPIRÉ', 'refusé : '||left(sqlerrm,60), 'OK');
  end;

  begin
    select public.accept_invitation('verif-revoque') into v_res;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Accepter un lien RÉVOQUÉ', 'accepté', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Accepter un lien RÉVOQUÉ', 'refusé : '||left(sqlerrm,60), 'OK');
  end;

  begin
    select public.accept_invitation('verif-consomme') into v_res;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Rejouer un lien DÉJÀ UTILISÉ', 'accepté', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Rejouer un lien DÉJÀ UTILISÉ', 'refusé : '||left(sqlerrm,60), 'OK');
  end;

  begin
    select public.accept_invitation('jeton-devine-au-hasard') into v_res;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Deviner un jeton INCONNU', 'accepté', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Invitations', 'Deviner un jeton INCONNU', 'refusé : '||left(sqlerrm,60), 'OK');
  end;

  select state into v_state from public.invitation_preview('verif-expire');
  insert into _r (domaine, tentative, observe, verdict)
    values ('Invitations', 'Aperçu d''un lien expiré', 'state = '||coalesce(v_state,'(null)'),
            case when v_state='expiree' then 'OK' else 'FAILLE' end);

  select state into v_state from public.invitation_preview('jeton-devine-au-hasard');
  insert into _r (domaine, tentative, observe, verdict)
    values ('Invitations', 'Aperçu d''un jeton inconnu', 'state = '||coalesce(v_state,'(null)'),
            case when v_state='invalide' then 'OK' else 'FAILLE' end);

  -- Le lien valide, lui, doit fonctionner — et donner accès aux données.
  select public.accept_invitation('verif-valide') into v_res;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Invitations', 'TÉMOIN — accepter un lien VALIDE',
            case when v_res = a then 'rejoint le foyer A' else 'foyer inattendu' end,
            case when v_res = a then 'OK' else 'FAILLE' end);

  select count(*) into n from public.events where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Invitations', 'TÉMOIN — après acceptation, les événements du foyer A', n || ' ligne(s)',
            case when n=1 then 'OK' else 'FAILLE' end);

  select count(*) into n from storage.objects
    where bucket_id='attachments' and name like a::text || '/%';
  insert into _r (domaine, tentative, observe, verdict)
    values ('Invitations', 'TÉMOIN — après acceptation, les pièces jointes du foyer A', n || ' objet(s)',
            case when n=1 then 'OK' else 'FAILLE' end);

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Acte 5 — L'espace nounou n'ouvre que ce qu'il doit
--
-- Jusqu'ici, tout le produit reposait sur une règle simple : on voit le foyer
-- dont on est membre, et rien d'autre. L'espace nounou (migration `0014`)
-- introduit le premier accès accordé à quelqu'un qui n'est PAS membre. C'est
-- donc le premier endroit où « membre du foyer » et « autorisé à lire »
-- cessent de coïncider, et c'est exactement ce qu'il faut éprouver.
--
-- Chloé accepte le lien envoyé pour Sofia, par le vrai chemin applicatif
-- (`accept_nanny_access`). Elle doit alors voir sa fiche, ses gardes, l'enfant
-- qu'elle garde et le foyer — et rien de plus. Ni le calendrier, ni les
-- tâches, ni les courses, ni les recommandations. Ni l'enfant qu'elle ne garde
-- pas.
-- ---------------------------------------------------------------------------

do $$
declare
  v_nounou_user text := 'user_nounou_' || replace(gen_random_uuid()::text, '-', '');
  v_res uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_nounou_user, 'role','authenticated')::text, true);
  set local role authenticated;

  begin
    select public.accept_nanny_access('jeton-nounou-verif') into v_res;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'TÉMOIN — accepter un lien d''accès valide',
              case when v_res is null then 'aucun rattachement' else 'rattachée' end,
              case when v_res is null then 'FAILLE' else 'OK' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'TÉMOIN — accepter un lien d''accès valide',
              'refusé : '||left(sqlerrm, 60), 'FAILLE');
  end;

  reset role;
  insert into _t values ('nounou_user', v_nounou_user);
end $$;

do $$
declare
  a uuid := (select valeur from _t where cle='foyer_a')::uuid;
  b uuid := (select valeur from _t where cle='foyer_b')::uuid;
  v_nounou_user text := (select valeur from _t where cle='nounou_user');
  v_nounou uuid := (select valeur from _t where cle='nounou')::uuid;
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_nounou_user, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Ce à quoi elle a droit.
  select count(*) into n from public.nannies where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'TÉMOIN — la nounou lit sa propre fiche', n || ' ligne(s)',
            case when n=1 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.households where id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'TÉMOIN — la nounou lit le foyer qui l''emploie', n || ' ligne(s)',
            case when n=1 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.childcare_sessions where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'TÉMOIN — la nounou lit la garde qu''on lui confie', n || ' ligne(s)',
            case when n=1 then 'OK' else 'FAILLE' end);

  -- Ce à quoi elle n'a PAS droit, alors même qu'elle a un pied dans le foyer.
  select count(*) into n from public.children
   where household_id = a and first_name = 'Max';
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'L''enfant qu''elle ne garde pas', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.children where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'TÉMOIN — seul l''enfant qu''elle garde', n || ' ligne(s)',
            case when n=1 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.events where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'Le calendrier du foyer', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.tasks where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'Les tâches du foyer', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.recommendations where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'Les recos du foyer', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.shopping_lists where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'Les listes de courses du foyer', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.attachments where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'Les pièces jointes du foyer', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  select count(*) into n from public.household_members where household_id = a;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'La liste des membres du foyer', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  -- Et rien du tout du foyer d'à côté.
  select count(*) into n from public.households where id = b;
  insert into _r (domaine, tentative, observe, verdict)
    values ('Espace nounou', 'Le foyer B, qui ne l''emploie pas', n || ' ligne(s)',
            case when n=0 then 'OK' else 'FAILLE' end);

  -- Écriture : elle déclare ses heures, elle ne touche pas au foyer.
  begin
    update public.households set name='PIRATE' where id = a;
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'Renommer le foyer qui l''emploie', n || ' ligne(s)',
              case when n=0 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'Renommer le foyer qui l''emploie', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.events (household_id, title, starts_at, ends_at)
    values (a, 'Intrusion nounou', now(), now() + interval '1 hour');
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'Créer un événement dans le foyer', 'inséré', 'FAILLE');
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'Créer un événement dans le foyer', 'refusé ('||sqlstate||')', 'OK');
  end;

  begin
    insert into public.nanny_availability (household_id, nanny_id, starts_at, ends_at, reason)
    values (a, v_nounou, now() + interval '10 days', now() + interval '11 days', 'Congés');
    get diagnostics n = row_count;
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'TÉMOIN — déclarer sa propre indisponibilité', n || ' ligne(s)',
              case when n=1 then 'OK' else 'FAILLE' end);
  exception when others then
    insert into _r (domaine, tentative, observe, verdict)
      values ('Espace nounou', 'TÉMOIN — déclarer sa propre indisponibilité',
              'refusé ('||sqlstate||')', 'FAILLE');
  end;

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Résultat
-- ---------------------------------------------------------------------------

select ordre, domaine, tentative, observe, verdict from _r order by ordre;

select
  count(*) filter (where verdict='OK')     as reussites,
  count(*) filter (where verdict='FAILLE') as failles,
  case when count(*) filter (where verdict='FAILLE') = 0
       then 'ÉTANCHE'
       else 'TROU DANS LES RÈGLES' end     as conclusion
from _r;

-- ---------------------------------------------------------------------------
-- Démontage — la transaction est annulée, rien ne subsiste
-- ---------------------------------------------------------------------------

rollback;
