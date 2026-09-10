-- ===========================================================================
-- Tribu — 0005 — Nounous, gardes, heures réalisées et bilans mensuels
--
-- Deux principes structurent cette partie :
--
--  1. Les horaires sont des instants complets (timestamptz), jamais des
--     heures nues. Une garde 20:30 → 01:15 traverse minuit sans traitement
--     particulier : la soustraction de deux instants donne la bonne durée.
--
--  2. Le tarif appliqué est FIGÉ dans la garde au moment où elle est créée.
--     Modifier le tarif par défaut d'une nounou ne rejoue donc jamais les
--     bilans passés.
-- ===========================================================================

create type public.childcare_status as enum ('prevue', 'a_confirmer', 'confirmee', 'annulee');
create type public.payment_status as enum ('a_payer', 'paye');

-- ---------------------------------------------------------------------------
-- nannies — pas de compte utilisateur nécessaire
-- ---------------------------------------------------------------------------

create table public.nannies (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  phone         text,
  email         text,
  color         text not null default 'lavande',
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index nannies_household_idx on public.nannies (household_id);

create trigger nannies_set_updated_at
  before update on public.nannies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- nanny_rates — historique des tarifs horaires par date d'effet
-- ---------------------------------------------------------------------------

create table public.nanny_rates (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  nanny_id       uuid not null references public.nannies (id) on delete cascade,
  hourly_rate    numeric(8, 2) not null check (hourly_rate >= 0),
  effective_from date not null,
  created_at     timestamptz not null default now(),
  unique (nanny_id, effective_from)
);

create index nanny_rates_nanny_idx on public.nanny_rates (nanny_id, effective_from desc);

-- Tarif en vigueur à une date donnée : le plus récent dont la date d'effet
-- n'est pas postérieure. Sert à pré-remplir une nouvelle garde ; une fois la
-- garde créée, c'est la valeur copiée dans la garde qui fait foi.
create or replace function public.nanny_rate_at(p_nanny_id uuid, p_on date)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select nr.hourly_rate
  from public.nanny_rates nr
  where nr.nanny_id = p_nanny_id
    and nr.effective_from <= p_on
  order by nr.effective_from desc
  limit 1;
$$;

grant execute on function public.nanny_rate_at(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- childcare_sessions — une garde
--
-- Une garde récurrente est matérialisée en gardes individuelles : chacune a
-- ses propres heures réalisées, son propre tarif figé et son propre statut.
-- ---------------------------------------------------------------------------

create table public.childcare_sessions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  nanny_id      uuid not null references public.nannies (id) on delete restrict,
  -- Garde miroir dans le calendrier familial.
  event_id      uuid references public.events (id) on delete set null,

  -- Horaires prévus.
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz not null,

  -- Horaires réellement effectués, saisis ou confirmés après la garde.
  actual_start    timestamptz,
  actual_end      timestamptz,

  unpaid_break_minutes integer not null default 0
    check (unpaid_break_minutes >= 0),

  -- Correction manuelle tracée : on ne réécrit jamais les heures saisies.
  adjustment_minutes integer not null default 0,
  adjustment_reason  text,
  adjusted_by        uuid references public.household_members (id) on delete set null,
  adjusted_at        timestamptz,

  -- Tarif figé à la création de la garde.
  applied_hourly_rate numeric(8, 2) not null check (applied_hourly_rate >= 0),

  status        public.childcare_status not null default 'prevue',
  location      text,
  notes         text,

  confirmed_at  timestamptz,
  confirmed_by  uuid references public.household_members (id) on delete set null,

  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint childcare_scheduled_order check (scheduled_end > scheduled_start),
  constraint childcare_actual_order check (
    actual_start is null or actual_end is null or actual_end > actual_start
  ),
  -- Les deux horaires réels vont de pair.
  constraint childcare_actual_pair check (
    (actual_start is null) = (actual_end is null)
  ),
  -- Une correction manuelle doit être motivée.
  constraint childcare_adjustment_reason check (
    adjustment_minutes = 0 or nullif(btrim(coalesce(adjustment_reason, '')), '') is not null
  ),

  -- Durée prévue, en minutes.
  scheduled_minutes integer generated always as (
    greatest(
      0,
      floor(extract(epoch from (scheduled_end - scheduled_start)) / 60)::integer
    )
  ) stored,

  -- Durée réalisée, en minutes : heures réelles, moins les pauses non
  -- rémunérées, plus l'éventuelle correction manuelle. Le passage à minuit
  -- est géré par construction. Jamais négative.
  worked_minutes integer generated always as (
    case
      when actual_start is null or actual_end is null then null
      else greatest(
        0,
        floor(extract(epoch from (actual_end - actual_start)) / 60)::integer
          - unpaid_break_minutes
          + adjustment_minutes
      )
    end
  ) stored
);

create index childcare_household_idx
  on public.childcare_sessions (household_id, scheduled_start desc);
create index childcare_nanny_idx
  on public.childcare_sessions (nanny_id, scheduled_start desc);
create index childcare_status_idx
  on public.childcare_sessions (household_id, status);
create index childcare_event_idx
  on public.childcare_sessions (event_id) where event_id is not null;

create trigger childcare_sessions_set_updated_at
  before update on public.childcare_sessions
  for each row execute function public.set_updated_at();

-- Trace automatique de la correction manuelle et de la confirmation.
create or replace function public.sync_childcare_flags()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and (new.adjustment_minutes is distinct from old.adjustment_minutes
          or new.adjustment_reason is distinct from old.adjustment_reason)
  then
    new.adjusted_at := now();
  end if;

  if new.status = 'confirmee' and new.confirmed_at is null then
    new.confirmed_at := now();
  elsif new.status <> 'confirmee' then
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;

  return new;
end;
$$;

create trigger childcare_sessions_sync_flags
  before insert or update on public.childcare_sessions
  for each row execute function public.sync_childcare_flags();

-- ---------------------------------------------------------------------------
-- childcare_session_children — enfants gardés
-- ---------------------------------------------------------------------------

create table public.childcare_session_children (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  session_id    uuid not null references public.childcare_sessions (id) on delete cascade,
  child_id      uuid not null references public.children (id) on delete cascade,
  unique (session_id, child_id)
);

create index childcare_children_session_idx
  on public.childcare_session_children (session_id);
create index childcare_children_household_idx
  on public.childcare_session_children (household_id);

-- ---------------------------------------------------------------------------
-- childcare_extras — frais complémentaires (transport, repas, ...)
-- ---------------------------------------------------------------------------

create table public.childcare_extras (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  session_id    uuid not null references public.childcare_sessions (id) on delete cascade,
  label         text not null check (length(btrim(label)) between 1 and 80),
  amount        numeric(8, 2) not null,
  created_at    timestamptz not null default now()
);

create index childcare_extras_session_idx on public.childcare_extras (session_id);
create index childcare_extras_household_idx on public.childcare_extras (household_id);

-- ---------------------------------------------------------------------------
-- nanny_settlements — statut de règlement d'un mois donné
-- ---------------------------------------------------------------------------

create table public.nanny_settlements (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  nanny_id      uuid not null references public.nannies (id) on delete cascade,
  -- Premier jour du mois concerné.
  month         date not null,
  status        public.payment_status not null default 'a_payer',
  paid_at       date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (nanny_id, month),
  constraint nanny_settlements_month_start check (extract(day from month) = 1)
);

create index nanny_settlements_household_idx
  on public.nanny_settlements (household_id, month desc);

create trigger nanny_settlements_set_updated_at
  before update on public.nanny_settlements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Vue de calcul : montant d'une garde
--
-- `security_invoker` fait appliquer la RLS des tables sous-jacentes au
-- lecteur de la vue, et non à son propriétaire : la vue ne contourne donc
-- aucun contrôle d'accès.
-- ---------------------------------------------------------------------------

create view public.childcare_session_totals
with (security_invoker = on)
as
select
  s.id                as session_id,
  s.household_id,
  s.nanny_id,
  s.scheduled_start,
  s.scheduled_end,
  s.status,
  s.scheduled_minutes,
  s.worked_minutes,
  s.applied_hourly_rate,
  coalesce(x.extras_total, 0)::numeric(10, 2) as extras_total,
  -- Montant des heures : arrondi au centime, à la minute près.
  case
    when s.worked_minutes is null then null
    else round((s.worked_minutes::numeric / 60) * s.applied_hourly_rate, 2)
  end as hours_amount,
  case
    when s.worked_minutes is null then null
    else round((s.worked_minutes::numeric / 60) * s.applied_hourly_rate, 2)
         + coalesce(x.extras_total, 0)
  end as total_amount
from public.childcare_sessions s
left join lateral (
  select sum(e.amount) as extras_total
  from public.childcare_extras e
  where e.session_id = s.id
) x on true;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.nannies                    enable row level security;
alter table public.nanny_rates                enable row level security;
alter table public.childcare_sessions         enable row level security;
alter table public.childcare_session_children enable row level security;
alter table public.childcare_extras           enable row level security;
alter table public.nanny_settlements          enable row level security;

create policy "nounous: lire"
  on public.nannies for select to authenticated
  using (public.is_household_member(household_id));
create policy "nounous: ajouter"
  on public.nannies for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "nounous: modifier"
  on public.nannies for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "nounous: supprimer"
  on public.nannies for delete to authenticated
  using (public.is_household_member(household_id));

create policy "tarifs: lire"
  on public.nanny_rates for select to authenticated
  using (public.is_household_member(household_id));
create policy "tarifs: ajouter"
  on public.nanny_rates for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "tarifs: modifier"
  on public.nanny_rates for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "tarifs: supprimer"
  on public.nanny_rates for delete to authenticated
  using (public.is_household_member(household_id));

create policy "gardes: lire"
  on public.childcare_sessions for select to authenticated
  using (public.is_household_member(household_id));
create policy "gardes: ajouter"
  on public.childcare_sessions for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "gardes: modifier"
  on public.childcare_sessions for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "gardes: supprimer"
  on public.childcare_sessions for delete to authenticated
  using (public.is_household_member(household_id));

create policy "enfants gardes: lire"
  on public.childcare_session_children for select to authenticated
  using (public.is_household_member(household_id));
create policy "enfants gardes: ajouter"
  on public.childcare_session_children for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "enfants gardes: supprimer"
  on public.childcare_session_children for delete to authenticated
  using (public.is_household_member(household_id));

create policy "frais: lire"
  on public.childcare_extras for select to authenticated
  using (public.is_household_member(household_id));
create policy "frais: ajouter"
  on public.childcare_extras for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "frais: modifier"
  on public.childcare_extras for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "frais: supprimer"
  on public.childcare_extras for delete to authenticated
  using (public.is_household_member(household_id));

create policy "reglements: lire"
  on public.nanny_settlements for select to authenticated
  using (public.is_household_member(household_id));
create policy "reglements: ajouter"
  on public.nanny_settlements for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "reglements: modifier"
  on public.nanny_settlements for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "reglements: supprimer"
  on public.nanny_settlements for delete to authenticated
  using (public.is_household_member(household_id));
