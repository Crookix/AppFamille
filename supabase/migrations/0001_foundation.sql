-- ===========================================================================
-- Tribu — 0001 — Socle : extensions, utilitaires, foyers, membres,
--                invitations, enfants.
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.household_role as enum ('admin', 'adulte');

-- ---------------------------------------------------------------------------
-- profiles — miroir applicatif de auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Création automatique du profil à l'inscription.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- households — le foyer
-- ---------------------------------------------------------------------------

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  timezone    text not null default 'Europe/Paris',
  is_demo     boolean not null default false,
  created_by  uuid not null references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- household_members — les adultes du foyer (un compte chacun)
-- ---------------------------------------------------------------------------

create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.household_role not null default 'adulte',
  display_name  text not null check (length(btrim(display_name)) between 1 and 60),
  color         text not null default 'terracotta',
  avatar_path   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);
create index household_members_household_idx on public.household_members (household_id);

create trigger household_members_set_updated_at
  before update on public.household_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Fonctions d'appartenance.
--
-- SECURITY DEFINER : elles contournent la RLS de household_members, ce qui
-- évite la récursion infinie lorsqu'une policy de household_members interroge
-- household_members. `search_path` est figé pour empêcher tout détournement.
-- ---------------------------------------------------------------------------

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
      and hm.user_id = (select auth.uid())
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
      and hm.user_id = (select auth.uid())
      and hm.role = 'admin'
  );
$$;

-- Identifiant du membre courant dans un foyer donné (null s'il n'en est pas).
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
    and hm.user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_admin(uuid) from public;
revoke all on function public.current_member_id(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_admin(uuid) to authenticated;
grant execute on function public.current_member_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Garde-fou sur household_members.
--
-- La policy « modifier ma fiche » laisse chacun changer son prénom affiché,
-- sa couleur et son avatar. Sans ce trigger, elle laisserait aussi un membre
-- se promouvoir administrateur : une policy WITH CHECK ne voit pas l'ancienne
-- ligne et ne peut donc pas détecter le changement de rôle.
-- ---------------------------------------------------------------------------

create or replace function public.guard_household_member_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.user_id is distinct from old.user_id then
    raise exception 'Un membre ne peut pas être déplacé vers un autre foyer ou un autre compte.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     and not public.is_household_admin(old.household_id) then
    raise exception 'Seul un administrateur du foyer peut changer un rôle.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger household_members_guard_update
  before update on public.household_members
  for each row execute function public.guard_household_member_update();

-- Le foyer doit toujours conserver au moins un administrateur.
create or replace function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
  v_admins    integer;
begin
  v_household := coalesce(new.household_id, old.household_id);

  -- Le foyer entier peut disparaître : dans ce cas on ne bloque rien.
  if not exists (select 1 from public.households h where h.id = v_household) then
    return coalesce(new, old);
  end if;

  select count(*) into v_admins
  from public.household_members hm
  where hm.household_id = v_household
    and hm.role = 'admin';

  if v_admins = 0 then
    raise exception 'Le foyer doit conserver au moins un administrateur.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create constraint trigger household_members_guard_last_admin
  after update or delete on public.household_members
  deferrable initially deferred
  for each row execute function public.guard_last_admin();

-- ---------------------------------------------------------------------------
-- invitations — lien d'invitation d'un second adulte
--
-- Seul le condensat SHA-256 du jeton est stocké : le jeton en clair n'existe
-- que dans le lien envoyé. Une invitation est valable 7 jours par défaut.
-- ---------------------------------------------------------------------------

create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  email         text,
  role          public.household_role not null default 'adulte',
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  created_by    uuid not null references auth.users (id) on delete cascade,
  accepted_at   timestamptz,
  accepted_by   uuid references auth.users (id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (expires_at > created_at)
);

create index invitations_household_idx on public.invitations (household_id);
create index invitations_pending_idx
  on public.invitations (household_id)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- children — enfants du foyer, sans compte utilisateur
-- ---------------------------------------------------------------------------

create table public.children (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  first_name     text not null check (length(btrim(first_name)) between 1 and 60),
  birth_date     date,
  color          text not null default 'sauge',
  photo_path     text,
  school_name    text,
  school_contact text,
  notes          text,
  allergies      text,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index children_household_idx on public.children (household_id);

create trigger children_set_updated_at
  before update on public.children
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- child_activities — activités régulières d'un enfant
-- ---------------------------------------------------------------------------

create table public.child_activities (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  child_id      uuid not null references public.children (id) on delete cascade,
  label         text not null check (length(btrim(label)) between 1 and 80),
  weekday       smallint check (weekday between 1 and 7), -- 1 = lundi
  start_time    time,
  end_time      time,
  location      text,
  notes         text,
  created_at    timestamptz not null default now()
);

create index child_activities_child_idx on public.child_activities (child_id);
create index child_activities_household_idx on public.child_activities (household_id);

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.profiles           enable row level security;
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.invitations        enable row level security;
alter table public.children           enable row level security;
alter table public.child_activities   enable row level security;

-- --- profiles --------------------------------------------------------------
-- Chacun lit et modifie son propre profil ; on peut aussi lire le profil des
-- personnes avec qui l'on partage un foyer (pour afficher prénom et avatar).

create policy "profiles: lire le sien"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: lire ceux du foyer"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.household_members theirs
      where theirs.user_id = public.profiles.id
        and public.is_household_member(theirs.household_id)
    )
  );

create policy "profiles: modifier le sien"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- --- households ------------------------------------------------------------
-- Pas de policy INSERT : la création passe par la fonction `create_household`
-- (0004), qui crée le foyer, son administrateur et sa liste de courses en une
-- seule transaction.

create policy "households: lire les siens"
  on public.households for select to authenticated
  using (public.is_household_member(id));

create policy "households: modifier si admin"
  on public.households for update to authenticated
  using (public.is_household_admin(id))
  with check (public.is_household_admin(id));

create policy "households: supprimer si admin"
  on public.households for delete to authenticated
  using (public.is_household_admin(id));

-- --- household_members -----------------------------------------------------
-- Pas de policy INSERT : on ne s'ajoute pas soi-même à un foyer. L'ajout passe
-- par `create_household` ou par `accept_invitation`, qui vérifie le jeton.

create policy "membres: lire ceux de mes foyers"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

-- Chacun ajuste sa propre fiche ; le trigger `guard_household_member_update`
-- empêche de s'attribuer le rôle administrateur au passage.
create policy "membres: modifier ma fiche"
  on public.household_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "membres: administrer"
  on public.household_members for update to authenticated
  using (public.is_household_admin(household_id))
  with check (public.is_household_admin(household_id));

-- Un administrateur peut retirer un membre ; chacun peut quitter le foyer.
create policy "membres: retirer"
  on public.household_members for delete to authenticated
  using (
    public.is_household_admin(household_id)
    or user_id = (select auth.uid())
  );

-- --- invitations -----------------------------------------------------------
-- Les invitations ne sont lisibles que par le foyer émetteur ; l'invité, lui,
-- passe par `accept_invitation`, qui vérifie le jeton et son expiration.

create policy "invitations: lire celles de mon foyer"
  on public.invitations for select to authenticated
  using (public.is_household_member(household_id));

create policy "invitations: creer si admin"
  on public.invitations for insert to authenticated
  with check (
    public.is_household_admin(household_id)
    and created_by = (select auth.uid())
  );

create policy "invitations: revoquer si admin"
  on public.invitations for update to authenticated
  using (public.is_household_admin(household_id))
  with check (public.is_household_admin(household_id));

create policy "invitations: supprimer si admin"
  on public.invitations for delete to authenticated
  using (public.is_household_admin(household_id));

-- --- children --------------------------------------------------------------

create policy "enfants: lire"
  on public.children for select to authenticated
  using (public.is_household_member(household_id));

create policy "enfants: ajouter"
  on public.children for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "enfants: modifier"
  on public.children for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "enfants: supprimer"
  on public.children for delete to authenticated
  using (public.is_household_member(household_id));

-- --- child_activities ------------------------------------------------------

create policy "activites: lire"
  on public.child_activities for select to authenticated
  using (public.is_household_member(household_id));

create policy "activites: ajouter"
  on public.child_activities for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "activites: modifier"
  on public.child_activities for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "activites: supprimer"
  on public.child_activities for delete to authenticated
  using (public.is_household_member(household_id));
