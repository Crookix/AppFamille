-- ===========================================================================
-- Tribu — 0009 — File d'attente des suppressions à répercuter vers Google
--
-- Quand un événement Tribu est supprimé, sa ligne de correspondance
-- (`google_event_links`) disparaît avec lui par cascade : on perd alors
-- l'identifiant Google, et l'événement resterait orphelin dans l'agenda.
--
-- Un déclencheur recopie donc l'identifiant Google dans une file AVANT la
-- disparition. La synchronisation la vide ensuite. Ce découplage évite aussi
-- de rendre la suppression d'un événement dépendante de la disponibilité de
-- Google : on peut supprimer hors connexion, la répercussion suivra.
-- ===========================================================================

create table public.google_deletion_queue (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  google_calendar_ref uuid not null references public.google_calendars (id) on delete cascade,
  google_event_id     text not null,
  -- Origine de l'événement supprimé : on ne répercute que ce que Tribu avait
  -- créé. Un événement importé de Google et supprimé côté Tribu ne doit pas
  -- disparaître de l'agenda personnel de son propriétaire.
  origin              public.event_origin not null,
  requested_at        timestamptz not null default now(),
  processed_at        timestamptz,
  error_message       text,
  unique (google_calendar_ref, google_event_id)
);

create index google_deletion_queue_pending_idx
  on public.google_deletion_queue (household_id)
  where processed_at is null;

create or replace function public.enqueue_google_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.google_deletion_queue (
    household_id, google_calendar_ref, google_event_id, origin
  )
  select
    l.household_id,
    l.google_calendar_ref,
    l.google_event_id,
    old.origin
  from public.google_event_links l
  where l.event_id = old.id
  on conflict (google_calendar_ref, google_event_id) do nothing;

  return old;
end;
$$;

create trigger events_enqueue_google_deletion
  before delete on public.events
  for each row execute function public.enqueue_google_deletion();

revoke all on function public.enqueue_google_deletion() from public, anon, authenticated;

-- La file n'est manipulée que par le serveur de synchronisation
-- (`service_role`). RLS active + lecture seule pour le foyer, afin que
-- l'interface puisse afficher un éventuel échec de répercussion.
alter table public.google_deletion_queue enable row level security;

create policy "file suppressions google: lire"
  on public.google_deletion_queue for select to authenticated
  using (public.is_household_member(household_id));
