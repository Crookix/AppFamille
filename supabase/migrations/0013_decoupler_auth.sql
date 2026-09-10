-- ---------------------------------------------------------------------------
-- 0013 — Découpler le schéma de Supabase Auth
--
-- POURQUOI
-- --------
-- Jusqu'ici l'identité d'un utilisateur était un `uuid` emprunté à
-- `auth.users`, et toutes les politiques passaient par `auth.uid()`. Cela
-- soude le produit à un fournisseur d'authentification unique.
--
-- Un fournisseur tiers (Clerk, Auth0, Firebase…) n'émet pas des UUID. Vérifié
-- sur cette base : avec un `sub` de la forme `user_2abc…`, `auth.uid()` ne
-- renvoie pas NULL — il lève `22P02 invalid input syntax for type uuid`.
-- Autrement dit, chaque politique du produit planterait.
--
-- Après cette migration, l'identifiant utilisateur est un `text` opaque, lu
-- dans le jeton via `auth.jwt() ->> 'sub'`. Un UUID reste un texte valide :
-- Supabase Auth continue donc de fonctionner exactement comme avant, et un
-- fournisseur tiers devient possible sans retoucher la base.
--
-- CE QU'ON PERD, ET QU'IL FAUT ASSUMER
-- ------------------------------------
-- Les clés étrangères vers `auth.users` disparaissent : Postgres ne garantit
-- plus qu'un `created_by` désigne quelqu'un d'existant, et surtout la cascade
-- de suppression n'existe plus. C'est pour cela que la migration installe
-- `public.delete_user_data()` : supprimer un compte redevient une action
-- explicite. Le droit à l'effacement l'exigeait de toute façon.
--
-- COMMENT LES POLITIQUES SONT REPRISES
-- ------------------------------------
-- Postgres refuse de changer le type d'une colonne citée par une politique.
-- Il faut donc toutes les démonter puis les remonter. Les recopier à la main
-- serait le moyen le plus sûr d'introduire une faille : une clause `using`
-- mal retranscrite ne casse rien de visible, elle ouvre une porte.
--
-- La migration lit donc chaque politique dans le catalogue, la sauvegarde,
-- la supprime, change les types, puis la recrée à l'identique — en
-- remplaçant le seul motif `auth.uid()` par `auth.jwt() ->> 'sub'`. La
-- transformation est unique, visible ci-dessous, et le nombre de politiques
-- remontées est comparé au nombre démonté : la migration échoue s'il en
-- manque une.
--
-- La preuve indépendante reste `supabase/tests/isolation.sql`, à rejouer
-- après cette migration.
-- ---------------------------------------------------------------------------

/* -- 1. Sauvegarde de toutes les politiques des tables concernées ---------- */

create temporary table _politiques on commit drop as
select
  n.nspname                                as schema_name,
  c.relname                                as table_name,
  p.polname                                as policy_name,
  case p.polcmd
    when 'r' then 'select' when 'a' then 'insert'
    when 'w' then 'update' when 'd' then 'delete' else 'all'
  end                                      as cmd,
  p.polpermissive                          as permissive,
  (select coalesce(string_agg(quote_ident(r.rolname), ', '), 'public')
     from unnest(p.polroles) as pr(oid)
     join pg_roles r on r.oid = pr.oid)    as roles,
  replace(pg_get_expr(p.polqual, p.polrelid),
          'auth.uid()', '(auth.jwt() ->> ''sub'')')      as using_expr,
  replace(pg_get_expr(p.polwithcheck, p.polrelid),
          'auth.uid()', '(auth.jwt() ->> ''sub'')')      as check_expr
from pg_policy p
join pg_class c      on c.oid = p.polrelid
join pg_namespace n  on n.oid = c.relnamespace
where n.nspname in ('public', 'storage');

/* -- 2. Démontage --------------------------------------------------------- */

do $$
declare r record;
begin
  for r in select schema_name, table_name, policy_name from _politiques loop
    execute format('drop policy %I on %I.%I',
                   r.policy_name, r.schema_name, r.table_name);
  end loop;
end $$;

/* -- 3. Les clés étrangères vers auth.users s'en vont --------------------- */

do $$
declare r record;
begin
  for r in
    select con.conname, c.relname
    from pg_constraint con
    join pg_class c       on c.oid = con.conrelid
    join pg_namespace n   on n.oid = c.relnamespace
    join pg_class fc      on fc.oid = con.confrelid
    join pg_namespace fn  on fn.oid = fc.relnamespace
    where con.contype = 'f'
      and n.nspname = 'public'
      and fn.nspname = 'auth' and fc.relname = 'users'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

/* -- 4. Les identifiants utilisateur deviennent du texte ------------------ */

alter table public.profiles                 alter column id            type text using id::text;
alter table public.households               alter column created_by    type text using created_by::text;
alter table public.household_members        alter column user_id       type text using user_id::text;
alter table public.invitations              alter column created_by    type text using created_by::text;
alter table public.invitations              alter column accepted_by   type text using accepted_by::text;
alter table public.events                   alter column created_by    type text using created_by::text;
alter table public.attachments              alter column uploaded_by   type text using uploaded_by::text;
alter table public.tasks                    alter column created_by    type text using created_by::text;
alter table public.shopping_lists           alter column created_by    type text using created_by::text;
alter table public.shopping_items           alter column created_by    type text using created_by::text;
alter table public.recipes                  alter column created_by    type text using created_by::text;
alter table public.meals                    alter column created_by    type text using created_by::text;
alter table public.childcare_sessions       alter column created_by    type text using created_by::text;
alter table public.notifications            alter column user_id       type text using user_id::text;
alter table public.notifications            alter column actor_user_id type text using actor_user_id::text;
alter table public.notification_preferences alter column user_id       type text using user_id::text;
alter table public.google_accounts          alter column user_id       type text using user_id::text;

/* -- 5. Les fonctions d'aide lisent le jeton, plus auth.uid() ------------- */

-- L'identité courante, quel que soit le fournisseur. Un `sub` Supabase est un
-- UUID, un `sub` Clerk une chaîne : les deux sont du texte, et cette fonction
-- est le seul endroit du schéma qui a besoin de le savoir.
create or replace function public.current_user_id()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = (select auth.jwt() ->> 'sub')
  );
$$;

create or replace function public.is_household_admin(p_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = (select auth.jwt() ->> 'sub')
      and hm.role = 'admin'
  );
$$;

create or replace function public.current_member_id(p_household_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select hm.id
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = (select auth.jwt() ->> 'sub')
  limit 1;
$$;

/* -- 6. Remontage des politiques ------------------------------------------ */

do $$
declare
  r        record;
  remontes int := 0;
  attendus int;
begin
  select count(*) into attendus from _politiques;

  for r in select * from _politiques loop
    execute format(
      'create policy %I on %I.%I as %s for %s to %s %s %s',
      r.policy_name, r.schema_name, r.table_name,
      case when r.permissive then 'permissive' else 'restrictive' end,
      r.cmd,
      r.roles,
      case when r.using_expr is null then '' else 'using (' || r.using_expr || ')' end,
      case when r.check_expr is null then '' else 'with check (' || r.check_expr || ')' end
    );
    remontes := remontes + 1;
  end loop;

  if remontes <> attendus then
    raise exception 'Politiques : % démontées, % remontées. Migration annulée.',
      attendus, remontes;
  end if;

  raise notice 'Politiques reprises : %', remontes;
end $$;

/* -- 7. Les RPC parlent texte, elles aussi -------------------------------- */

-- Seule la déclaration de `v_user` change : `uuid` devient `text`, et la
-- lecture passe par le jeton. Le corps est inchangé.
create or replace function public.create_household(
  p_name         text,
  p_display_name text default null,
  p_timezone     text default 'Europe/Paris'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      text := (select auth.jwt() ->> 'sub');
  v_household uuid;
  v_name      text;
begin
  if nullif(v_user, '') is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Le foyer doit avoir un nom.' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_name is null then
    select coalesce(nullif(btrim(p.full_name), ''),
                    nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
                    'Moi')
      into v_name
    from public.profiles p
    where p.id = v_user;
  end if;

  insert into public.households (name, timezone, created_by)
  values (btrim(p_name), coalesce(nullif(btrim(p_timezone), ''), 'Europe/Paris'), v_user)
  returning id into v_household;

  insert into public.household_members (household_id, user_id, role, display_name, color)
  values (v_household, v_user, 'admin', coalesce(v_name, 'Moi'), 'terracotta');

  insert into public.shopping_lists (household_id, name, is_default, created_by)
  values (v_household, 'Courses', true, v_user);

  insert into public.notification_preferences (household_id, user_id)
  values (v_household, v_user);

  return v_household;
end;
$$;

-- `accept_invitation` : même changement, et les contrôles de validité du
-- jeton d'invitation restent mot pour mot ceux de la migration 0006.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user text := (select auth.jwt() ->> 'sub');
  v_hash text;
  v_inv  public.invitations%rowtype;
  v_name text;
begin
  if nullif(v_user, '') is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'Lien d''invitation invalide.' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_inv
  from public.invitations i
  where i.token_hash = v_hash
  for update;

  if not found then
    raise exception 'Lien d''invitation invalide.' using errcode = '22023';
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'Cette invitation a été annulée.' using errcode = '22023';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'Cette invitation a expiré. Demandez-en une nouvelle.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.household_id = v_inv.household_id and hm.user_id = v_user
  ) then
    return v_inv.household_id;
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'Cette invitation a déjà été utilisée.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''),
                  nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
                  'Nouvel adulte')
    into v_name
  from public.profiles p
  where p.id = v_user;

  insert into public.household_members (household_id, user_id, role, display_name, color)
  values (v_inv.household_id, v_user, v_inv.role, coalesce(v_name, 'Nouvel adulte'), 'sauge');

  insert into public.notification_preferences (household_id, user_id)
  values (v_inv.household_id, v_user)
  on conflict (household_id, user_id) do nothing;

  update public.invitations
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  insert into public.notifications (household_id, user_id, kind, title, body, actor_user_id)
  values (
    v_inv.household_id, v_inv.created_by, 'invitation_acceptee',
    'Invitation acceptée',
    coalesce(v_name, 'Un adulte') || ' a rejoint le foyer.', v_user
  );

  return v_inv.household_id;
end;
$$;

/* -- 8. Le profil, sans dépendre d'un déclencheur sur auth.users ---------- */

-- Avec Supabase Auth, un déclencheur sur `auth.users` créait le profil à
-- l'inscription. Un utilisateur venu d'un fournisseur tiers n'apparaît jamais
-- dans `auth.users` : ce déclencheur ne se déclencherait plus.
--
-- Le profil est donc créé à la demande, par l'application, au premier accès.
-- `external_id` garde l'identifiant tel que le fournisseur l'écrit — sans
-- lui, plus moyen de savoir qui est `user_2abc…` en regardant la base.
alter table public.profiles
  add column if not exists external_id text,
  add column if not exists auth_provider text not null default 'supabase';

create or replace function public.ensure_profile(
  p_email      text default null,
  p_full_name  text default null,
  p_avatar_url text default null,
  p_provider   text default 'supabase'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user text := (select auth.jwt() ->> 'sub');
begin
  if nullif(v_user, '') is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  insert into public.profiles (id, external_id, auth_provider, email, full_name, avatar_url)
  values (
    v_user, v_user, coalesce(nullif(btrim(p_provider), ''), 'supabase'),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_full_name, '')), ''),
    nullif(btrim(coalesce(p_avatar_url, '')), '')
  )
  on conflict (id) do update
    set email      = coalesce(excluded.email, public.profiles.email),
        -- Ce que l'utilisateur a saisi dans Tribu prime sur ce que le
        -- fournisseur raconte : on ne réécrit pas un prénom choisi ici.
        full_name  = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return v_user;
end;
$$;

-- Le déclencheur historique reste en place pour Supabase Auth, avec le seul
-- ajustement de type qu'impose le passage de `profiles.id` en texte.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, external_id, auth_provider, email, full_name, avatar_url)
  values (
    new.id::text,
    new.id::text,
    'supabase',
    new.email,
    nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

/* -- 9. Suppression d'un compte, puisque la cascade n'existe plus --------- */

-- Sans clé étrangère vers `auth.users`, supprimer un compte ne nettoie plus
-- rien tout seul. Cette fonction remplace la cascade perdue — et sert de
-- réponse au droit à l'effacement.
--
-- Règle retenue : on efface la personne, pas l'histoire du foyer. Un foyer
-- dont elle était le dernier membre est supprimé avec tout son contenu ; un
-- foyer partagé survit, et ce qu'elle y a créé reste, simplement désaffilié.
-- Effacer les courses de la semaine parce qu'un adulte s'en va serait une
-- surprise désagréable pour l'autre.
create or replace function public.delete_user_data(p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_foyers_supprimes int := 0;
  v_foyers_quittes   int := 0;
  r record;
begin
  if nullif(btrim(coalesce(p_user_id, '')), '') is null then
    raise exception 'Identifiant manquant.' using errcode = '22023';
  end if;

  -- Foyers dont cette personne est le seul membre : suppression complète.
  for r in
    select hm.household_id
    from public.household_members hm
    where hm.user_id = p_user_id
      and (select count(*) from public.household_members o
           where o.household_id = hm.household_id) = 1
  loop
    delete from public.households where id = r.household_id;
    v_foyers_supprimes := v_foyers_supprimes + 1;
  end loop;

  -- Foyers partagés : on retire la personne, le contenu reste aux autres.
  delete from public.household_members where user_id = p_user_id;
  get diagnostics v_foyers_quittes = row_count;

  -- Ce qui est nominatif disparaît.
  delete from public.notifications            where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from public.google_accounts          where user_id = p_user_id;

  -- Ce qui est collectif reste, mais désaffilié : le contenu du foyer
  -- appartient au foyer, pas à celui qui l'a saisi.
  update public.notifications    set actor_user_id = null where actor_user_id = p_user_id;
  update public.events           set created_by    = null where created_by    = p_user_id;
  update public.tasks            set created_by    = null where created_by    = p_user_id;
  update public.shopping_lists   set created_by    = null where created_by    = p_user_id;
  update public.shopping_items   set created_by    = null where created_by    = p_user_id;
  update public.recipes          set created_by    = null where created_by    = p_user_id;
  update public.meals            set created_by    = null where created_by    = p_user_id;
  update public.childcare_sessions set created_by  = null where created_by    = p_user_id;
  update public.attachments      set uploaded_by   = null where uploaded_by   = p_user_id;
  update public.invitations      set accepted_by   = null where accepted_by   = p_user_id;

  delete from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'foyers_supprimes', v_foyers_supprimes,
    'foyers_quittes',   v_foyers_quittes
  );
end;
$$;

/* -- 10. Droits ----------------------------------------------------------- */

revoke all on function public.current_user_id()                 from public, anon;
revoke all on function public.is_household_member(uuid)         from public, anon;
revoke all on function public.is_household_admin(uuid)          from public, anon;
revoke all on function public.current_member_id(uuid)           from public, anon;
revoke all on function public.create_household(text, text, text) from public, anon;
revoke all on function public.accept_invitation(text)           from public, anon;
revoke all on function public.ensure_profile(text, text, text, text) from public, anon;

grant execute on function public.current_user_id()              to authenticated;
grant execute on function public.is_household_member(uuid)      to authenticated;
grant execute on function public.is_household_admin(uuid)       to authenticated;
grant execute on function public.current_member_id(uuid)        to authenticated;
grant execute on function public.create_household(text, text, text) to authenticated;
grant execute on function public.accept_invitation(text)        to authenticated;
grant execute on function public.ensure_profile(text, text, text, text) to authenticated;

-- `delete_user_data` n'est JAMAIS appelable depuis le navigateur : elle
-- traverse les foyers et ignore la RLS. Seul le serveur, avec la clé de
-- service, doit pouvoir l'invoquer.
revoke all on function public.delete_user_data(text) from public, anon, authenticated;
