-- ===========================================================================
-- Tribu — 0004 — Recettes et planification des repas
-- ===========================================================================

create type public.meal_slot as enum ('petit_dejeuner', 'dejeuner', 'diner');

-- ---------------------------------------------------------------------------
-- recipes
-- ---------------------------------------------------------------------------

create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 120),
  servings      integer not null default 4 check (servings between 1 and 50),
  steps         text,
  source_url    text,
  notes         text,
  is_favorite   boolean not null default false,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index recipes_household_idx on public.recipes (household_id);

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recipe_ingredients
--
-- Les quantités sont exprimées pour `recipes.servings` portions ; le calcul au
-- prorata se fait à la génération des courses.
-- ---------------------------------------------------------------------------

create table public.recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  recipe_id     uuid not null references public.recipes (id) on delete cascade,
  label         text not null check (length(btrim(label)) between 1 and 120),
  label_key     text not null,
  quantity      numeric(10, 2) check (quantity is null or quantity > 0),
  unit          text,
  aisle         public.shop_aisle not null default 'autre',
  position      integer not null default 0
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_household_idx on public.recipe_ingredients (household_id);

-- ---------------------------------------------------------------------------
-- meals — planning hebdomadaire
--
-- Un repas peut n'être qu'un intitulé libre (« Restes du dimanche ») : la
-- recette est facultative, comme demandé.
-- ---------------------------------------------------------------------------

create table public.meals (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  meal_date     date not null,
  slot          public.meal_slot not null,
  title         text not null check (length(btrim(title)) between 1 and 160),
  recipe_id     uuid references public.recipes (id) on delete set null,
  servings      integer check (servings is null or servings between 1 and 50),
  notes         text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, meal_date, slot)
);

create index meals_household_date_idx on public.meals (household_id, meal_date);

create trigger meals_set_updated_at
  before update on public.meals
  for each row execute function public.set_updated_at();

-- Les articles de courses issus d'un repas pointent vers ce repas ; si le
-- repas disparaît, le lien se dénoue mais l'article reste (l'adulte décide
-- ensuite de le garder ou non).
alter table public.shopping_items
  add constraint shopping_items_source_meal_fkey
  foreign key (source_meal_id) references public.meals (id) on delete set null;

-- ---------------------------------------------------------------------------
-- meal_participants — qui est présent à ce repas
-- ---------------------------------------------------------------------------

create table public.meal_participants (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  meal_id       uuid not null references public.meals (id) on delete cascade,
  member_id     uuid references public.household_members (id) on delete cascade,
  child_id      uuid references public.children (id) on delete cascade,
  constraint meal_participants_one_target check (
    (member_id is not null)::int + (child_id is not null)::int = 1
  )
);

create index meal_participants_meal_idx on public.meal_participants (meal_id);
create index meal_participants_household_idx on public.meal_participants (household_id);
create unique index meal_participants_unique_member
  on public.meal_participants (meal_id, member_id) where member_id is not null;
create unique index meal_participants_unique_child
  on public.meal_participants (meal_id, child_id) where child_id is not null;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.recipes             enable row level security;
alter table public.recipe_ingredients  enable row level security;
alter table public.meals               enable row level security;
alter table public.meal_participants   enable row level security;

create policy "recettes: lire"
  on public.recipes for select to authenticated
  using (public.is_household_member(household_id));
create policy "recettes: ajouter"
  on public.recipes for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "recettes: modifier"
  on public.recipes for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "recettes: supprimer"
  on public.recipes for delete to authenticated
  using (public.is_household_member(household_id));

create policy "ingredients: lire"
  on public.recipe_ingredients for select to authenticated
  using (public.is_household_member(household_id));
create policy "ingredients: ajouter"
  on public.recipe_ingredients for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "ingredients: modifier"
  on public.recipe_ingredients for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "ingredients: supprimer"
  on public.recipe_ingredients for delete to authenticated
  using (public.is_household_member(household_id));

create policy "repas: lire"
  on public.meals for select to authenticated
  using (public.is_household_member(household_id));
create policy "repas: ajouter"
  on public.meals for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "repas: modifier"
  on public.meals for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "repas: supprimer"
  on public.meals for delete to authenticated
  using (public.is_household_member(household_id));

create policy "convives: lire"
  on public.meal_participants for select to authenticated
  using (public.is_household_member(household_id));
create policy "convives: ajouter"
  on public.meal_participants for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "convives: modifier"
  on public.meal_participants for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "convives: supprimer"
  on public.meal_participants for delete to authenticated
  using (public.is_household_member(household_id));
