-- ===========================================================================
-- MyFamily — 0014 — Espace nounou : accès personnel, indisponibilités,
--                   déclaration des heures
--
-- POURQUOI
--
-- Jusqu'ici une nounou était une fiche, pas quelqu'un qui se connecte : la
-- table `nannies` porte encore le commentaire « pas de compte utilisateur
-- nécessaire ». La famille saisissait tout, y compris les heures réellement
-- faites.
--
-- Cette migration ouvre à la nounou un accès à elle, et rien qu'à elle.
--
-- LE CHOIX STRUCTURANT
--
-- La nounou n'est PAS membre du foyer. C'est délibéré : toutes les politiques
-- du projet reposent sur `is_household_member()`, et l'ajouter comme membre
-- lui ouvrirait le calendrier, les listes, les repas, les tâches et les fiches
-- des enfants. Il aurait fallu reprendre dix migrations de politiques, où le
-- moindre oubli aurait laissé passer des lignes sans lever la moindre erreur.
--
-- Ici c'est l'inverse : n'étant membre de rien, la nounou ne voit RIEN par
-- défaut. Chaque chose qu'elle doit voir est ouverte explicitement, une
-- politique à la fois, et la liste de ces politiques tient dans ce fichier.
-- Ce qui n'y figure pas lui reste fermé.
--
-- LE LIEN AVEC SON IDENTITÉ
--
-- Une nounou reçoit un lien d'invitation, comme un adulte du foyer : seul le
-- condensat SHA-256 du jeton est stocké, jamais le lien. En l'acceptant, elle
-- attache son identité de connexion à sa fiche. Cette identité est un TEXTE lu
-- dans le jeton (`auth.jwt() ->> 'sub'`), jamais `auth.uid()` — avec un
-- identifiant Clerk, `auth.uid()` lève `22P02` et fait tomber la politique
-- entière au lieu de refuser l'accès. Voir la migration 0013.
--
-- LES HEURES NE SONT PAS ÉCRITES DIRECTEMENT
--
-- La nounou ne modifie jamais `childcare_sessions` : elle dépose une
-- DÉCLARATION, que la famille accepte ou refuse. Deux raisons. D'abord la
-- traçabilité : les heures validées restent celles du foyer, la déclaration
-- garde la trace de ce qui a été annoncé. Ensuite la sécurité : la RLS de
-- PostgreSQL ne sait pas restreindre des COLONNES. Autoriser la nounou à
-- modifier sa garde l'autoriserait aussi à en changer le tarif appliqué ou le
-- statut de paiement.
-- ===========================================================================

create type public.declaration_status as enum ('en_attente', 'acceptee', 'refusee');

-- ---------------------------------------------------------------------------
-- nanny_accesses — le lien entre une fiche nounou et une identité de connexion
-- ---------------------------------------------------------------------------

create table public.nanny_accesses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  nanny_id     uuid not null references public.nannies (id) on delete cascade,

  -- Adresse à qui le lien est destiné. Indicative : c'est le jeton qui fait
  -- foi, pas l'adresse de connexion.
  email        text,

  -- Seul le condensat est stocké : la base ne contient jamais le lien.
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  invited_by   uuid references public.household_members (id) on delete set null,

  -- Identité de connexion, renseignée à l'acceptation. Texte, jamais uuid.
  user_id      text,
  accepted_at  timestamptz,
  revoked_at   timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint nanny_accesses_expiry check (expires_at > created_at),
  -- Les deux vont de pair : un accès accepté porte une identité.
  constraint nanny_accesses_accepted_pair check (
    (accepted_at is null) = (user_id is null)
  )
);

create index nanny_accesses_household_idx on public.nanny_accesses (household_id);
create index nanny_accesses_nanny_idx     on public.nanny_accesses (nanny_id);
create index nanny_accesses_user_idx
  on public.nanny_accesses (user_id) where user_id is not null;

-- Une seule fiche active par identité et par nounou : réinviter quelqu'un qui
-- a déjà accès ne crée pas un second accès concurrent.
create unique index nanny_accesses_one_active
  on public.nanny_accesses (nanny_id)
  where accepted_at is not null and revoked_at is null;

create trigger nanny_accesses_set_updated_at
  before update on public.nanny_accesses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Qui suis-je ? — l'équivalent de `is_household_member`, côté nounou
--
-- `security definer` parce que la fonction lit `nanny_accesses`, dont la
-- politique dépend elle-même de cette réponse. Sans cela, la récursion.
-- ---------------------------------------------------------------------------

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

-- Le foyer auquel l'appelante est rattachée comme nounou, s'il existe.
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

-- ---------------------------------------------------------------------------
-- nanny_availability — les créneaux où la nounou n'est PAS disponible
--
-- On stocke l'indisponibilité et non la disponibilité : une nounou est
-- présumée disponible, et n'a donc à déclarer que les exceptions. L'inverse
-- l'obligerait à remplir un agenda entier pour être joignable.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- childcare_declarations — ce que la nounou annonce avoir fait
--
-- Une déclaration par garde. Tant qu'elle est « en_attente », la nounou peut
-- la corriger ; une fois tranchée par le foyer, elle est figée.
-- ---------------------------------------------------------------------------

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
  -- Une seule déclaration par garde : la corriger, ce n'est pas en ajouter une.
  unique (session_id)
);

create index childcare_declarations_household_idx
  on public.childcare_declarations (household_id, status);
create index childcare_declarations_nanny_idx
  on public.childcare_declarations (nanny_id, created_at desc);

create trigger childcare_declarations_set_updated_at
  before update on public.childcare_declarations
  for each row execute function public.set_updated_at();

-- Trace de l'examen, posée par la base plutôt que par l'appelant.
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

-- ===========================================================================
-- Row Level Security
--
-- Deux publics, jamais confondus : le foyer (`is_household_member`) et la
-- nounou (`is_linked_nanny`). Chaque table porte son `household_id`, et
-- aucune politique n'ouvre quoi que ce soit à qui n'est ni l'un ni l'autre.
-- ===========================================================================

alter table public.nanny_accesses          enable row level security;
alter table public.nanny_availability      enable row level security;
alter table public.childcare_declarations  enable row level security;

-- --- nanny_accesses --------------------------------------------------------
-- Le foyer gère les accès ; la nounou lit le sien, sans jamais le modifier.

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

-- --- nanny_availability ----------------------------------------------------
-- La nounou est seule à poser ses indisponibilités ; le foyer les lit pour ne
-- pas proposer une garde à l'aveugle, mais ne les écrit pas à sa place.

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

-- --- childcare_declarations ------------------------------------------------

create policy "declarations: le foyer lit"
  on public.childcare_declarations for select
  using (public.is_household_member(household_id));

-- Le foyer tranche : il ne crée pas de déclaration à la place de la nounou.
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
    -- La garde déclarée doit être la sienne : sans ce contrôle, une nounou
    -- pourrait déclarer des heures sur la garde d'une autre.
    and exists (
      select 1
      from public.childcare_sessions cs
      where cs.id = session_id
        and cs.nanny_id = childcare_declarations.nanny_id
        and cs.household_id = childcare_declarations.household_id
    )
  );

-- Elle corrige tant que le foyer n'a pas tranché, et ne peut pas se
-- l'accepter à elle-même : le statut doit rester « en_attente » des deux
-- côtés de la modification.
create policy "declarations: la nounou corrige"
  on public.childcare_declarations for update
  using (public.is_linked_nanny(nanny_id) and status = 'en_attente')
  with check (public.is_linked_nanny(nanny_id) and status = 'en_attente');

-- ===========================================================================
-- Ce que la nounou voit du foyer — et rien de plus
--
-- Chaque politique ci-dessous s'ajoute à celles du foyer, sans les toucher.
-- Elles sont volontairement étroites : la nounou voit sa fiche, ses gardes,
-- les enfants qu'elle garde, et le nom du foyer pour savoir où elle est.
-- Elle ne voit ni le calendrier, ni les listes, ni les repas, ni les tâches,
-- ni les fiches des enfants qu'elle ne garde pas.
-- ===========================================================================

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

-- Les enfants qu'elle garde, et eux seuls. Une fratrie dont elle ne garde
-- qu'un enfant ne lui est pas révélée en entier.
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

-- Le nom et le fuseau du foyer : sans eux, impossible d'afficher une heure
-- juste ni de dire chez qui elle travaille.
create policy "foyers: la nounou lit le sien"
  on public.households for select
  using (public.is_nanny_of_household(id));

-- ===========================================================================
-- Accepter un lien d'accès
--
-- La nounou n'est membre de rien : aucune politique ne l'autorise à écrire
-- dans `nanny_accesses`, et c'est voulu. L'acceptation passe donc par une
-- fonction `security definer`, comme `accept_invitation` pour un adulte.
--
-- Le jeton est revérifié ici, à l'acceptation, et pas seulement à l'affichage
-- de la page : entre les deux, il a pu expirer ou être révoqué.
-- ===========================================================================

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

  -- Déjà accepté : par la même personne, c'est un rappel sans conséquence ;
  -- par quelqu'un d'autre, le lien a servi et ne sert plus.
  if v_access.accepted_at is not null then
    if v_access.user_id = v_user then
      return v_access.nanny_id;
    end if;
    raise exception 'Ce lien a déjà été utilisé.' using errcode = '22023';
  end if;

  -- Un accès plus ancien pour la même nounou laisse la place au nouveau,
  -- sans quoi l'index d'unicité ferait échouer l'acceptation.
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

-- ===========================================================================
-- Droits d'exécution
-- ===========================================================================

revoke all on function public.is_linked_nanny(uuid)        from public, anon;
revoke all on function public.is_nanny_of_household(uuid)  from public, anon;
revoke all on function public.accept_nanny_access(text)    from public, anon;

grant execute on function public.is_linked_nanny(uuid)       to authenticated;
grant execute on function public.is_nanny_of_household(uuid) to authenticated;
grant execute on function public.accept_nanny_access(text)   to authenticated;
