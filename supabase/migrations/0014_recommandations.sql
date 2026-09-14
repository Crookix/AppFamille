-- ---------------------------------------------------------------------------
-- 0014 — Reco : ce que la famille se recommande
--
-- POURQUOI
-- --------
-- Les envies d'un foyer circulent aujourd'hui par messages : « il paraît que
-- ce film est bien », « pense au spectacle du 12 », « idée cadeau pour Léa ».
-- Elles se perdent entre deux conversations, et personne ne sait, le moment
-- venu, ce qui avait été proposé ni par qui.
--
-- Une seule table suffit pour les quatre cas visés — film, série, théâtre,
-- idée cadeau — parce qu'ils partagent la même forme : un titre, qui le
-- recommande, pourquoi, un lien, et un état qui va de l'envie à la chose
-- faite. Seules les colonnes propres au cadeau (destinataire, occasion, prix)
-- restent vides pour les autres genres ; c'est moins coûteux que quatre
-- tables presque identiques à joindre.
--
-- `reco_kind` comporte volontairement « autre » : un restaurant, un livre ou
-- un podcast entrent sans migration. Ajouter une valeur à un type énuméré
-- Postgres est possible, mais ne peut pas être utilisée dans la transaction
-- qui l'ajoute — autant prévoir la porte de sortie tout de suite.
--
-- `recommendation_wants` porte les « envies » : chaque membre peut dire qu'il
-- a envie, ce qui donne au foyer un ordre de préférence sans que personne ne
-- tranche à la place des autres.
-- ---------------------------------------------------------------------------

create type public.reco_kind as enum ('film', 'serie', 'theatre', 'cadeau', 'autre');

-- Trois états, dont le libellé s'adapte au genre côté interface : « à voir »
-- pour un film, « idée » pour un cadeau. La base, elle, n'en connaît que
-- trois, ce qui garde les filtres simples.
create type public.reco_status as enum ('idee', 'en_cours', 'fait');

-- ---------------------------------------------------------------------------
-- recommendations
-- ---------------------------------------------------------------------------

create table public.recommendations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,

  kind          public.reco_kind not null,
  status        public.reco_status not null default 'idee',

  title         text not null check (length(btrim(title)) between 1 and 200),
  -- Réalisateur, chaîne, troupe, enseigne : « de qui » ou « où », selon le genre.
  author        text check (author is null or length(btrim(author)) <= 120),
  -- Pourquoi on le recommande. C'est le champ qui fait la différence entre une
  -- liste de titres et une vraie recommandation.
  note          text check (note is null or length(note) <= 2000),
  url           text check (url is null or length(btrim(url)) <= 2000),
  rating        smallint check (rating is null or rating between 1 and 5),

  -- Propre aux idées cadeaux, laissé vide ailleurs.
  recipient_label    text check (recipient_label is null or length(btrim(recipient_label)) <= 80),
  recipient_child_id uuid references public.children (id) on delete set null,
  occasion           text check (occasion is null or length(btrim(occasion)) <= 80),
  price              numeric(10, 2) check (price is null or price >= 0),

  -- Qui recommande : un membre, pour afficher son avatar et sa couleur.
  suggested_by  uuid references public.household_members (id) on delete set null,

  done_at       timestamptz,
  done_by       uuid references public.household_members (id) on delete set null,

  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index recommendations_household_idx
  on public.recommendations (household_id, created_at desc);
-- L'écran par défaut montre ce qui reste à faire, genre par genre.
create index recommendations_ouvertes_idx
  on public.recommendations (household_id, kind) where status <> 'fait';
create index recommendations_enfant_idx
  on public.recommendations (recipient_child_id) where recipient_child_id is not null;
-- Les deux renvois vers `household_members` sont indexés pour la même raison
-- qu'en 0011 : sans index, retirer quelqu'un du foyer oblige Postgres à
-- parcourir toute la table pour appliquer le `on delete set null`.
create index recommendations_suggested_by_idx
  on public.recommendations (suggested_by) where suggested_by is not null;
create index recommendations_done_by_idx
  on public.recommendations (done_by) where done_by is not null;

create trigger recommendations_set_updated_at
  before update on public.recommendations
  for each row execute function public.set_updated_at();

-- Cohérence entre l'état et l'horodatage, quel que soit le chemin d'écriture.
-- Même raison que pour les tâches : une reprise en arrière doit effacer la
-- trace, sinon « vu le 3 mars » survit à un retour en « à voir ».
create or replace function public.sync_recommendation_done()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'fait' and new.done_at is null then
    new.done_at := now();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;

create trigger recommendations_sync_done
  before insert or update on public.recommendations
  for each row execute function public.sync_recommendation_done();

-- ---------------------------------------------------------------------------
-- recommendation_wants — « moi aussi j'ai envie »
--
-- L'unicité par (reco, membre) est ce qui rend l'appui idempotent : deux
-- appuis rapprochés depuis deux onglets ne comptent qu'une envie.
-- ---------------------------------------------------------------------------

create table public.recommendation_wants (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  member_id         uuid not null references public.household_members (id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (recommendation_id, member_id)
);

create index recommendation_wants_household_idx
  on public.recommendation_wants (household_id);
create index recommendation_wants_member_idx
  on public.recommendation_wants (member_id);

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.recommendations      enable row level security;
alter table public.recommendation_wants enable row level security;

create policy "reco: lire"
  on public.recommendations for select to authenticated
  using (public.is_household_member(household_id));
create policy "reco: ajouter"
  on public.recommendations for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "reco: modifier"
  on public.recommendations for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "reco: supprimer"
  on public.recommendations for delete to authenticated
  using (public.is_household_member(household_id));

-- Les envies se lisent à tout le foyer, mais ne s'ajoutent et ne se retirent
-- que pour soi : personne ne retire l'envie d'un autre.
create policy "envies reco: lire"
  on public.recommendation_wants for select to authenticated
  using (public.is_household_member(household_id));
create policy "envies reco: ajouter"
  on public.recommendation_wants for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and member_id = public.current_member_id(household_id)
  );
create policy "envies reco: supprimer"
  on public.recommendation_wants for delete to authenticated
  using (
    public.is_household_member(household_id)
    and member_id = public.current_member_id(household_id)
  );

-- ===========================================================================
-- Temps réel
--
-- Deux parents qui remplissent la liste le même soir doivent se voir l'un
-- l'autre. La publication ne contourne pas la RLS : chaque foyer ne reçoit
-- que ses propres lignes.
-- ===========================================================================

alter publication supabase_realtime add table public.recommendations;
alter publication supabase_realtime add table public.recommendation_wants;

-- ===========================================================================
-- Droit à l'effacement
--
-- `delete_user_data` (migration 0013) désaffilie le contenu collectif du
-- compte supprimé. La nouvelle table porte un `created_by` : sans cette
-- reprise, un identifiant survivrait à la suppression du compte. La fonction
-- est reprise en entier — `create or replace` ne connaît pas de fusion — et
-- ne change que par la ligne `recommendations`.
-- ===========================================================================

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
  update public.recommendations  set created_by    = null where created_by    = p_user_id;
  update public.attachments      set uploaded_by   = null where uploaded_by   = p_user_id;
  update public.invitations      set accepted_by   = null where accepted_by   = p_user_id;

  delete from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'foyers_supprimes', v_foyers_supprimes,
    'foyers_quittes',   v_foyers_quittes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits (même durcissement qu'en 0008 et 0013)
--
-- `create or replace` conserve en principe les droits existants ; on les
-- réaffirme pour que la lecture du fichier suffise à savoir qui peut appeler
-- quoi, sans remonter deux migrations en arrière.
-- ---------------------------------------------------------------------------

revoke all on function public.sync_recommendation_done()
  from public, anon, authenticated;

revoke all on function public.delete_user_data(text)
  from public, anon, authenticated;
