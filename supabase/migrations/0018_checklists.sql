-- ---------------------------------------------------------------------------
-- 0018 — Check-lists : les listes qu'on refait à l'identique
--
-- POURQUOI UNE TROISIÈME SORTE DE LISTE
-- -------------------------------------
-- Le produit sait déjà noter ce qu'il faut faire (`tasks`) et ce qu'il faut
-- acheter (`shopping_items`). Il manque ce qu'on refait **à l'identique**, à
-- chaque départ : la valise des enfants, le sac de piscine, ce qu'on emporte
-- chez la nounou.
--
-- Ces listes-là ne se terminent pas, elles se **rejouent**. Les noter en
-- tâches obligerait à les recréer à chaque voyage, et une tâche cochée
-- disparaît — exactement ce qu'il ne faut pas ici, puisque la liste est le
-- patrimoine et les coches sont ce qui passe.
--
-- D'où la forme : le contenu vit dans `checklist_items` et survit ; seul
-- `is_checked` est remis à zéro. `last_reset_at` garde la trace du dernier
-- départ, ce qui évite de se demander si les coches encore en place datent de
-- ce matin ou du voyage précédent.
--
-- CE QU'ON N'A PAS MIS, ET POURQUOI
-- ---------------------------------
-- Ni échéance, ni responsable, ni récurrence. Ce sont les marques d'une tâche,
-- et les ajouter ici brouillerait la seule distinction qui rende les deux
-- écrans lisibles : une tâche est un engagement ponctuel, une check-list est un
-- modèle réutilisable.
-- ---------------------------------------------------------------------------

create table public.checklists (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,

  name          text not null check (length(btrim(name)) between 1 and 80),
  -- À quoi elle sert, quand on ne s'en souvient plus six mois après.
  note          text check (note is null or length(note) <= 500),
  position      integer not null default 0,

  -- Le dernier départ : sans cette date, on ne sait pas si les coches encore
  -- en place datent de ce matin ou du voyage d'avant.
  last_reset_at timestamptz,
  last_reset_by uuid references public.household_members (id) on delete set null,

  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index checklists_household_idx on public.checklists (household_id, position);
create index checklists_last_reset_by_idx
  on public.checklists (last_reset_by) where last_reset_by is not null;

create trigger checklists_set_updated_at
  before update on public.checklists
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- checklist_items — ce qu'on coche, et qu'on décoche
-- ---------------------------------------------------------------------------

create table public.checklist_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  checklist_id  uuid not null references public.checklists (id) on delete cascade,

  label         text not null check (length(btrim(label)) between 1 and 120),
  position      integer not null default 0,

  is_checked    boolean not null default false,
  checked_at    timestamptz,
  checked_by    uuid references public.household_members (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index checklist_items_liste_idx
  on public.checklist_items (checklist_id, position);
create index checklist_items_household_idx on public.checklist_items (household_id);
-- L'écran compte ce qui reste : c'est la requête chaude.
create index checklist_items_restants_idx
  on public.checklist_items (checklist_id) where not is_checked;
create index checklist_items_checked_by_idx
  on public.checklist_items (checked_by) where checked_by is not null;

create trigger checklist_items_set_updated_at
  before update on public.checklist_items
  for each row execute function public.set_updated_at();

-- Même garde-fou que pour les courses : décocher efface la trace, quel que
-- soit le chemin d'écriture. C'est ce qui rend la remise à zéro d'une
-- check-list aussi simple qu'un `is_checked = false` — le déclencheur se
-- charge du reste.
create or replace function public.sync_checklist_item_checked()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_checked and new.checked_at is null then
    new.checked_at := now();
  elsif not new.is_checked then
    new.checked_at := null;
    new.checked_by := null;
  end if;
  return new;
end;
$$;

create trigger checklist_items_sync_checked
  before insert or update on public.checklist_items
  for each row execute function public.sync_checklist_item_checked();

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.checklists      enable row level security;
alter table public.checklist_items enable row level security;

create policy "check-lists: lire"
  on public.checklists for select to authenticated
  using (public.is_household_member(household_id));
create policy "check-lists: ajouter"
  on public.checklists for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "check-lists: modifier"
  on public.checklists for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "check-lists: supprimer"
  on public.checklists for delete to authenticated
  using (public.is_household_member(household_id));

create policy "points de check-list: lire"
  on public.checklist_items for select to authenticated
  using (public.is_household_member(household_id));
create policy "points de check-list: ajouter"
  on public.checklist_items for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "points de check-list: modifier"
  on public.checklist_items for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "points de check-list: supprimer"
  on public.checklist_items for delete to authenticated
  using (public.is_household_member(household_id));

-- ===========================================================================
-- Temps réel
--
-- Deux adultes qui préparent la même valise, chacun dans une pièce : cocher
-- doit se voir sur l'autre téléphone, sinon on emporte deux fois le doudou et
-- zéro brosse à dents.
-- ===========================================================================

alter publication supabase_realtime add table public.checklists;
alter publication supabase_realtime add table public.checklist_items;

-- ===========================================================================
-- Droit à l'effacement
--
-- `checklists.created_by` porte un identifiant de compte : sans cette reprise,
-- il survivrait à la suppression de ce compte. `supabase/tests/effacement.sql`
-- le signalerait, mais autant ne pas avoir à être rattrapé.
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
  -- Le rattachement à une fiche nounou ne contient que cette personne :
  -- son identifiant, son adresse et le condensat de son lien d'accès.
  delete from public.nanny_accesses           where user_id = p_user_id;

  -- Ce qui est collectif reste, mais désaffilié : le contenu du foyer
  -- appartient au foyer, pas à celui qui l'a saisi.
  update public.notifications    set actor_user_id = null where actor_user_id = p_user_id;
  update public.households       set created_by    = null where created_by    = p_user_id;
  update public.events           set created_by    = null where created_by    = p_user_id;
  update public.tasks            set created_by    = null where created_by    = p_user_id;
  update public.shopping_lists   set created_by    = null where created_by    = p_user_id;
  update public.shopping_items   set created_by    = null where created_by    = p_user_id;
  update public.recipes          set created_by    = null where created_by    = p_user_id;
  update public.meals            set created_by    = null where created_by    = p_user_id;
  update public.childcare_sessions set created_by  = null where created_by    = p_user_id;
  update public.recommendations  set created_by    = null where created_by    = p_user_id;
  update public.checklists       set created_by    = null where created_by    = p_user_id;
  update public.attachments      set uploaded_by   = null where uploaded_by   = p_user_id;
  update public.invitations      set created_by    = null where created_by    = p_user_id;
  update public.invitations      set accepted_by   = null where accepted_by   = p_user_id;

  delete from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'foyers_supprimes', v_foyers_supprimes,
    'foyers_quittes',   v_foyers_quittes
  );
end;
$$;

revoke all on function public.sync_checklist_item_checked()
  from public, anon, authenticated;
revoke all on function public.delete_user_data(text)
  from public, anon, authenticated;
