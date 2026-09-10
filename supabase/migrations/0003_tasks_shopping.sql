-- ===========================================================================
-- Tribu — 0003 — Tâches partagées et listes de courses
-- ===========================================================================

create type public.task_status as enum ('a_faire', 'en_cours', 'termine');
create type public.task_priority as enum ('basse', 'normale', 'haute');

-- Rayons de magasin, dans l'ordre d'un parcours de courses classique.
create type public.shop_aisle as enum (
  'fruits_legumes',
  'boucherie_poissonnerie',
  'frais',
  'epicerie',
  'surgeles',
  'boissons',
  'boulangerie',
  'maison',
  'hygiene',
  'bebe',
  'autre'
);

-- ---------------------------------------------------------------------------
-- tasks — « qui fait quoi »
-- ---------------------------------------------------------------------------

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,

  title         text not null check (length(btrim(title)) between 1 and 200),
  description   text,
  status        public.task_status not null default 'a_faire',
  priority      public.task_priority not null default 'normale',

  assignee_id   uuid references public.household_members (id) on delete set null,
  due_date      date,
  due_time      time,

  -- Sous-tâches : une tâche fille pointe vers sa mère.
  parent_task_id uuid references public.tasks (id) on delete cascade,
  position       integer not null default 0,

  -- Rattachements facultatifs.
  child_id      uuid references public.children (id) on delete set null,
  event_id      uuid references public.events (id) on delete set null,

  -- Récurrence : RRULE RFC 5545. À la validation, la tâche est reconduite à
  -- l'échéance suivante et l'exécution est archivée dans task_completions.
  recurrence_rule text,

  completed_at  timestamptz,
  completed_by  uuid references public.household_members (id) on delete set null,

  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Une sous-tâche ne se subdivise pas elle-même, et ne se répète pas.
  constraint tasks_subtask_shape check (
    parent_task_id is null or recurrence_rule is null
  )
);

create index tasks_household_idx on public.tasks (household_id);
create index tasks_household_status_idx on public.tasks (household_id, status);
create index tasks_household_due_idx on public.tasks (household_id, due_date);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null;
create index tasks_event_idx on public.tasks (event_id) where event_id is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Cohérence entre le statut et l'horodatage de réalisation : quel que soit le
-- chemin d'écriture (interface, script, import), les deux restent alignés.
create or replace function public.sync_task_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'termine' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'termine' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_completion
  before insert or update on public.tasks
  for each row execute function public.sync_task_completion();

-- ---------------------------------------------------------------------------
-- task_completions — historique de réalisation (utile pour les récurrentes)
-- ---------------------------------------------------------------------------

create table public.task_completions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  title         text not null,
  due_date      date,
  completed_at  timestamptz not null default now(),
  completed_by  uuid references public.household_members (id) on delete set null
);

create index task_completions_task_idx on public.task_completions (task_id);
create index task_completions_household_idx
  on public.task_completions (household_id, completed_at desc);

-- ---------------------------------------------------------------------------
-- shopping_lists — plusieurs listes possibles par foyer
-- ---------------------------------------------------------------------------

create table public.shopping_lists (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  is_default    boolean not null default false,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index shopping_lists_household_idx on public.shopping_lists (household_id);
create unique index shopping_lists_single_default
  on public.shopping_lists (household_id) where is_default;

create trigger shopping_lists_set_updated_at
  before update on public.shopping_lists
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shopping_items
--
-- `source` distingue l'ajout manuel de l'ajout venant d'un repas : c'est ce
-- qui permet de régénérer les courses d'un menu sans effacer ce qu'un adulte
-- a ajouté à la main.
-- ---------------------------------------------------------------------------

create table public.shopping_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  list_id       uuid not null references public.shopping_lists (id) on delete cascade,

  label         text not null check (length(btrim(label)) between 1 and 120),
  -- Normalisé (minuscules, sans accent) pour le regroupement d'ingrédients.
  label_key     text not null,
  quantity      numeric(10, 2) check (quantity is null or quantity > 0),
  unit          text,
  note          text,
  aisle         public.shop_aisle not null default 'autre',

  is_checked    boolean not null default false,
  checked_at    timestamptz,
  checked_by    uuid references public.household_members (id) on delete set null,

  source        text not null default 'manuel' check (source in ('manuel', 'repas')),
  -- Repas d'origine, pour pouvoir retirer proprement les ingrédients d'un menu
  -- que l'on change.
  source_meal_id uuid,

  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index shopping_items_list_idx on public.shopping_items (list_id);
create index shopping_items_household_idx on public.shopping_items (household_id);
create index shopping_items_open_idx
  on public.shopping_items (list_id) where not is_checked;
create index shopping_items_meal_idx
  on public.shopping_items (source_meal_id) where source_meal_id is not null;

create trigger shopping_items_set_updated_at
  before update on public.shopping_items
  for each row execute function public.set_updated_at();

create or replace function public.sync_shopping_item_checked()
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

create trigger shopping_items_sync_checked
  before insert or update on public.shopping_items
  for each row execute function public.sync_shopping_item_checked();

-- ---------------------------------------------------------------------------
-- frequent_items — articles fréquents, proposés à l'ajout rapide
-- ---------------------------------------------------------------------------

create table public.frequent_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  label         text not null,
  label_key     text not null,
  unit          text,
  aisle         public.shop_aisle not null default 'autre',
  use_count     integer not null default 1,
  last_used_at  timestamptz not null default now(),
  unique (household_id, label_key)
);

create index frequent_items_household_idx
  on public.frequent_items (household_id, use_count desc);

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.tasks             enable row level security;
alter table public.task_completions  enable row level security;
alter table public.shopping_lists    enable row level security;
alter table public.shopping_items    enable row level security;
alter table public.frequent_items    enable row level security;

create policy "taches: lire"
  on public.tasks for select to authenticated
  using (public.is_household_member(household_id));
create policy "taches: ajouter"
  on public.tasks for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "taches: modifier"
  on public.tasks for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "taches: supprimer"
  on public.tasks for delete to authenticated
  using (public.is_household_member(household_id));

create policy "historique taches: lire"
  on public.task_completions for select to authenticated
  using (public.is_household_member(household_id));
create policy "historique taches: ajouter"
  on public.task_completions for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "historique taches: supprimer"
  on public.task_completions for delete to authenticated
  using (public.is_household_member(household_id));

create policy "listes: lire"
  on public.shopping_lists for select to authenticated
  using (public.is_household_member(household_id));
create policy "listes: ajouter"
  on public.shopping_lists for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "listes: modifier"
  on public.shopping_lists for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "listes: supprimer"
  on public.shopping_lists for delete to authenticated
  using (public.is_household_member(household_id));

create policy "courses: lire"
  on public.shopping_items for select to authenticated
  using (public.is_household_member(household_id));
create policy "courses: ajouter"
  on public.shopping_items for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "courses: modifier"
  on public.shopping_items for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "courses: supprimer"
  on public.shopping_items for delete to authenticated
  using (public.is_household_member(household_id));

create policy "articles frequents: lire"
  on public.frequent_items for select to authenticated
  using (public.is_household_member(household_id));
create policy "articles frequents: ajouter"
  on public.frequent_items for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "articles frequents: modifier"
  on public.frequent_items for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "articles frequents: supprimer"
  on public.frequent_items for delete to authenticated
  using (public.is_household_member(household_id));
