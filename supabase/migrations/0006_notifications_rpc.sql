-- ===========================================================================
-- Tribu — 0006 — Notifications, préférences, opérations sensibles (RPC)
--                et diffusion temps réel.
-- ===========================================================================

create type public.notification_kind as enum (
  'tache_attribuee',
  'tache_terminee',
  'evenement_modifie',
  'evenement_ajoute',
  'rappel',
  'garde_a_confirmer',
  'invitation_acceptee',
  'sync_google'
);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- Destinataire.
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          public.notification_kind not null,
  title         text not null,
  body          text,
  -- Chemin interne vers l'élément concerné (ex. /calendrier/<id>).
  link          text,
  -- Auteur de l'action, pour ne pas se notifier soi-même.
  actor_user_id uuid references auth.users (id) on delete set null,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- notification_preferences — un réglage par adulte et par foyer
-- ---------------------------------------------------------------------------

create table public.notification_preferences (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  tasks_assigned        boolean not null default true,
  tasks_completed       boolean not null default false,
  events_changed        boolean not null default true,
  event_reminders       boolean not null default true,
  childcare_to_confirm  boolean not null default true,
  google_sync_errors    boolean not null default true,
  push_enabled          boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (household_id, user_id)
);

create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Opérations sensibles — fonctions SECURITY DEFINER
--
-- Ces trois opérations ne peuvent pas se réduire à une policy :
--  * créer un foyer suppose de s'y inscrire soi-même comme administrateur,
--    ce qu'aucune policy d'INSERT sur household_members ne doit permettre ;
--  * accepter une invitation suppose de vérifier un jeton que l'on n'a pas
--    le droit de lire.
-- Elles sont donc écrites ici, avec leurs vérifications explicites.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- create_household — foyer + administrateur + liste de courses par défaut
-- ---------------------------------------------------------------------------

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
  v_user      uuid := (select auth.uid());
  v_household uuid;
  v_name      text;
begin
  if v_user is null then
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

revoke all on function public.create_household(text, text, text) from public;
grant execute on function public.create_household(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- invitation_preview — ce que l'invité voit AVANT d'accepter
--
-- Ne renvoie que le nom du foyer et celui de la personne qui invite : jamais
-- l'identifiant du foyer, ni la liste des membres, ni aucune donnée familiale.
-- Un jeton invalide, expiré, révoqué ou déjà utilisé donne un état explicite
-- plutôt qu'une erreur, pour permettre un message clair côté interface.
-- ---------------------------------------------------------------------------

create or replace function public.invitation_preview(p_token text)
returns table (
  state          text,
  household_name text,
  inviter_name   text,
  expires_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_inv  public.invitations%rowtype;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    return query select 'invalide'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_inv from public.invitations i where i.token_hash = v_hash;

  if not found then
    return query select 'invalide'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  return query
  select
    case
      when v_inv.revoked_at is not null  then 'revoquee'
      when v_inv.accepted_at is not null then 'deja_acceptee'
      when v_inv.expires_at <= now()     then 'expiree'
      else 'valide'
    end::text,
    h.name,
    coalesce(nullif(btrim(p.full_name), ''), 'Un membre du foyer'),
    v_inv.expires_at
  from public.households h
  left join public.profiles p on p.id = v_inv.created_by
  where h.id = v_inv.household_id;
end;
$$;

revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_invitation — vérifie le jeton puis inscrit l'adulte
--
-- Le jeton est revérifié ici, à l'acceptation : validité, non-révocation,
-- non-réutilisation et date d'expiration. `for update` sérialise deux
-- acceptations simultanées du même lien.
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
  v_inv  public.invitations%rowtype;
  v_name text;
begin
  if v_user is null then
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

  -- Déjà membre : on ne consomme pas l'invitation, on renvoie simplement le
  -- foyer pour que l'interface redirige sans afficher d'erreur inutile.
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
     set accepted_at = now(),
         accepted_by = v_user
   where id = v_inv.id;

  -- Prévient l'auteur de l'invitation.
  insert into public.notifications (household_id, user_id, kind, title, body, actor_user_id)
  values (
    v_inv.household_id,
    v_inv.created_by,
    'invitation_acceptee',
    'Invitation acceptée',
    coalesce(v_name, 'Un adulte') || ' a rejoint le foyer.',
    v_user
  );

  return v_inv.household_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.notifications             enable row level security;
alter table public.notification_preferences  enable row level security;

-- Une notification est strictement personnelle.
create policy "notifications: lire les miennes"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- On peut notifier un membre de son propre foyer (attribution d'une tâche,
-- modification d'un événement), mais jamais quelqu'un d'ailleurs, et jamais
-- en usurpant l'auteur de l'action.
create policy "notifications: notifier mon foyer"
  on public.notifications for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and actor_user_id = (select auth.uid())
    and exists (
      select 1 from public.household_members hm
      where hm.household_id = notifications.household_id
        and hm.user_id = notifications.user_id
    )
  );

create policy "notifications: marquer les miennes comme lues"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "notifications: supprimer les miennes"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "preferences: lire les miennes"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "preferences: creer les miennes"
  on public.notification_preferences for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_household_member(household_id)
  );

create policy "preferences: modifier les miennes"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ===========================================================================
-- Temps réel
--
-- Seules les tables réellement partagées à l'écran sont diffusées. La RLS
-- s'applique aussi au flux temps réel : un membre d'un autre foyer ne reçoit
-- rien.
-- ===========================================================================

alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.meals;
alter publication supabase_realtime add table public.childcare_sessions;
alter publication supabase_realtime add table public.notifications;
