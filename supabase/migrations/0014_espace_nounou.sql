-- ---------------------------------------------------------------------------
-- 0014 — Espace nounou : accès délégué, indisponibilités, déclarations
--
-- FICHIER RECONSTITUÉ — À RELIRE PAR SON AUTEUR
-- --------------------------------------------
-- Cette migration a été appliquée sur le projet Supabase le 14 septembre 2026
-- à 09:38 UTC, mais son fichier ne se trouvait dans aucune branche du dépôt.
-- Le corps ci-dessous est repris **à l'octet près** du journal
-- `supabase_migrations.schema_migrations`, et non deviné depuis le schéma :
-- son empreinte MD5 vaut `01e19abb0653c512e533e7fc1c218835`, identique à
-- celle enregistrée. Seul cet en-tête a été ajouté ; aucune instruction n'a
-- été touchée, conformément à la règle « une migration appliquée n'est jamais
-- modifiée ».
--
-- Le **pourquoi** manque, et c'est ce que ce dépôt demande en tête de chaque
-- migration : il reste à écrire par la personne qui a conçu l'espace nounou.
-- Ce qui suit ne décrit donc que ce que le SQL fait, tel qu'il se lit.
--
-- CE QUE FAIT CETTE MIGRATION
-- ---------------------------
-- Elle ouvre l'application à un tiers qui n'est pas membre du foyer : la
-- nounou. Trois tables neuves —
--
--   * `nanny_accesses`        le lien d'invitation et son acceptation. Comme
--                             les invitations de foyer, seul le condensat
--                             SHA-256 du jeton est stocké. Un index unique
--                             partiel garantit un seul accès actif par nounou.
--   * `nanny_availability`    les créneaux où la nounou se déclare indisponible.
--   * `childcare_declarations` les heures qu'elle déclare, que le foyer accepte
--                             ou refuse (`declaration_status`).
--
-- Deux fonctions `security definer` portent les droits : `is_linked_nanny()`
-- et `is_nanny_of_household()`, toutes deux fondées sur `auth.jwt() ->> 'sub'`
-- et jamais sur `auth.uid()`. Elles ouvrent en lecture seule, à la nounou
-- rattachée, la fiche nounou, ses gardes, les enfants qu'elle garde et le
-- foyer lui-même.
--
-- `accept_nanny_access()` échange un jeton contre un rattachement, en
-- révoquant les accès antérieurs de la même nounou.
-- ---------------------------------------------------------------------------

create type public.declaration_status as enum ('en_attente', 'acceptee', 'refusee');

create table public.nanny_accesses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  nanny_id     uuid not null references public.nannies (id) on delete cascade,
  email        text,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  invited_by   uuid references public.household_members (id) on delete set null,
  user_id      text,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint nanny_accesses_expiry check (expires_at > created_at),
  constraint nanny_accesses_accepted_pair check (
    (accepted_at is null) = (user_id is null)
  )
);

create index nanny_accesses_household_idx on public.nanny_accesses (household_id);
create index nanny_accesses_nanny_idx     on public.nanny_accesses (nanny_id);
create index nanny_accesses_user_idx
  on public.nanny_accesses (user_id) where user_id is not null;

create unique index nanny_accesses_one_active
  on public.nanny_accesses (nanny_id)
  where accepted_at is not null and revoked_at is null;

create trigger nanny_accesses_set_updated_at
  before update on public.nanny_accesses
  for each row execute function public.set_updated_at();

create or replace function public.is_linked_nanny(p_nanny_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.nanny_accesses na
    where na.nanny_id = p_nanny_id
      and na.user_id = (select auth.jwt() ->> 'sub')
      and na.accepted_at is not null
      and na.revoked_at is null
  );
$$;

create or replace function public.is_nanny_of_household(p_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.nanny_accesses na
    where na.household_id = p_household_id
      and na.user_id = (select auth.jwt() ->> 'sub')
      and na.accepted_at is not null
      and na.revoked_at is null
  );
$$;

create table public.nanny_availability (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  nanny_id     uuid not null references public.nannies (id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  reason       text check (reason is null or length(btrim(reason)) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint nanny_availability_order check (ends_at > starts_at)
);

create index nanny_availability_nanny_idx
  on public.nanny_availability (nanny_id, starts_at);
create index nanny_availability_household_idx
  on public.nanny_availability (household_id, starts_at);

create trigger nanny_availability_set_updated_at
  before update on public.nanny_availability
  for each row execute function public.set_updated_at();

create table public.childcare_declarations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id   uuid not null references public.childcare_sessions (id) on delete cascade,
  nanny_id     uuid not null references public.nannies (id) on delete cascade,
  declared_start       timestamptz not null,
  declared_end         timestamptz not null,
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes >= 0),
  note                 text check (note is null or length(btrim(note)) <= 500),
  status       public.declaration_status not null default 'en_attente',
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.household_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint childcare_declarations_order check (declared_end > declared_start),
  unique (session_id)
);

create index childcare_declarations_household_idx
  on public.childcare_declarations (household_id, status);
create index childcare_declarations_nanny_idx
  on public.childcare_declarations (nanny_id, created_at desc);

create trigger childcare_declarations_set_updated_at
  before update on public.childcare_declarations
  for each row execute function public.set_updated_at();

create or replace function public.sync_declaration_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'en_attente' then
      new.reviewed_at := null;
      new.reviewed_by := null;
    else
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger childcare_declarations_sync_review
  before update on public.childcare_declarations
  for each row execute function public.sync_declaration_review();

alter table public.nanny_accesses          enable row level security;
alter table public.nanny_availability      enable row level security;
alter table public.childcare_declarations  enable row level security;

create policy "acces nounou: le foyer lit"
  on public.nanny_accesses for select
  using (public.is_household_member(household_id));

create policy "acces nounou: le foyer invite"
  on public.nanny_accesses for insert
  with check (public.is_household_member(household_id));

create policy "acces nounou: le foyer revoque"
  on public.nanny_accesses for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "acces nounou: le foyer supprime"
  on public.nanny_accesses for delete
  using (public.is_household_member(household_id));

create policy "acces nounou: la nounou lit le sien"
  on public.nanny_accesses for select
  using (
    user_id = (select auth.jwt() ->> 'sub')
    and accepted_at is not null
    and revoked_at is null
  );

create policy "indispos: le foyer lit"
  on public.nanny_availability for select
  using (public.is_household_member(household_id));

create policy "indispos: la nounou lit les siennes"
  on public.nanny_availability for select
  using (public.is_linked_nanny(nanny_id));

create policy "indispos: la nounou ajoute"
  on public.nanny_availability for insert
  with check (public.is_linked_nanny(nanny_id));

create policy "indispos: la nounou modifie"
  on public.nanny_availability for update
  using (public.is_linked_nanny(nanny_id))
  with check (public.is_linked_nanny(nanny_id));

create policy "indispos: la nounou supprime"
  on public.nanny_availability for delete
  using (public.is_linked_nanny(nanny_id));

create policy "declarations: le foyer lit"
  on public.childcare_declarations for select
  using (public.is_household_member(household_id));

create policy "declarations: le foyer tranche"
  on public.childcare_declarations for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "declarations: le foyer supprime"
  on public.childcare_declarations for delete
  using (public.is_household_member(household_id));

create policy "declarations: la nounou lit les siennes"
  on public.childcare_declarations for select
  using (public.is_linked_nanny(nanny_id));

create policy "declarations: la nounou declare"
  on public.childcare_declarations for insert
  with check (
    public.is_linked_nanny(nanny_id)
    and status = 'en_attente'
    and exists (
      select 1
      from public.childcare_sessions cs
      where cs.id = session_id
        and cs.nanny_id = childcare_declarations.nanny_id
        and cs.household_id = childcare_declarations.household_id
    )
  );

create policy "declarations: la nounou corrige"
  on public.childcare_declarations for update
  using (public.is_linked_nanny(nanny_id) and status = 'en_attente')
  with check (public.is_linked_nanny(nanny_id) and status = 'en_attente');

create policy "nounous: la nounou lit sa fiche"
  on public.nannies for select
  using (public.is_linked_nanny(id));

create policy "gardes: la nounou lit les siennes"
  on public.childcare_sessions for select
  using (public.is_linked_nanny(nanny_id));

create policy "enfants gardes: la nounou lit les siens"
  on public.childcare_session_children for select
  using (
    exists (
      select 1
      from public.childcare_sessions cs
      where cs.id = childcare_session_children.session_id
        and public.is_linked_nanny(cs.nanny_id)
    )
  );

create policy "enfants: la nounou lit ceux qu'elle garde"
  on public.children for select
  using (
    exists (
      select 1
      from public.childcare_session_children csc
      join public.childcare_sessions cs on cs.id = csc.session_id
      where csc.child_id = children.id
        and public.is_linked_nanny(cs.nanny_id)
    )
  );

create policy "foyers: la nounou lit le sien"
  on public.households for select
  using (public.is_nanny_of_household(id));

create or replace function public.accept_nanny_access(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   text := (select auth.jwt() ->> 'sub');
  v_hash   text;
  v_access public.nanny_accesses%rowtype;
begin
  if nullif(v_user, '') is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'Ce lien n''est pas valable.' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_access
  from public.nanny_accesses na
  where na.token_hash = v_hash
  for update;

  if not found then
    raise exception 'Ce lien n''est pas valable.' using errcode = '22023';
  end if;

  if v_access.revoked_at is not null then
    raise exception 'Ce lien a été annulé.' using errcode = '22023';
  end if;

  if v_access.expires_at <= now() then
    raise exception 'Ce lien a expiré.' using errcode = '22023';
  end if;

  if v_access.accepted_at is not null then
    if v_access.user_id = v_user then
      return v_access.nanny_id;
    end if;
    raise exception 'Ce lien a déjà été utilisé.' using errcode = '22023';
  end if;

  update public.nanny_accesses
     set revoked_at = now()
   where nanny_id = v_access.nanny_id
     and id <> v_access.id
     and accepted_at is not null
     and revoked_at is null;

  update public.nanny_accesses
     set user_id = v_user,
         accepted_at = now()
   where id = v_access.id;

  return v_access.nanny_id;
end;
$$;

revoke all on function public.is_linked_nanny(uuid)        from public, anon;
revoke all on function public.is_nanny_of_household(uuid)  from public, anon;
revoke all on function public.accept_nanny_access(text)    from public, anon;

grant execute on function public.is_linked_nanny(uuid)       to authenticated;
grant execute on function public.is_nanny_of_household(uuid) to authenticated;
grant execute on function public.accept_nanny_access(text)   to authenticated;
