-- ===========================================================================
-- Tribu — 0002 — Calendrier familial, déplacements, pièces jointes
--                et modèle de synchronisation Google Agenda.
--
-- Le modèle Google est posé dès maintenant (et non greffé plus tard) : la
-- récurrence et les exceptions d'occurrence suivent volontairement la
-- structure de l'API Google Calendar (`recurringEventId` +
-- `originalStartTime`), ce qui rend la correspondance directe et évite une
-- traduction hasardeuse au moment de la synchronisation.
-- ===========================================================================

create type public.event_category as enum (
  'famille', 'ecole', 'sante', 'activite', 'voyage', 'garde', 'perso'
);

create type public.event_kind as enum ('standard', 'deplacement', 'garde');

create type public.event_origin as enum ('tribu', 'google');

create type public.google_share_mode as enum ('details', 'disponibilite');

create type public.transport_mode as enum (
  'train', 'avion', 'voiture', 'bus', 'bateau', 'velo', 'autre'
);

-- ---------------------------------------------------------------------------
-- google_accounts — compte Google relié (métadonnées non secrètes)
--
-- « Connexion au compte Google » et « autorisation Google Agenda » sont deux
-- choses distinctes : on peut être relié sans avoir accordé l'accès au
-- calendrier. `calendar_authorized` porte cette différence.
-- ---------------------------------------------------------------------------

create table public.google_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  google_sub          text not null,
  email               text,
  scopes              text[] not null default '{}',
  calendar_authorized boolean not null default false,
  connected_at        timestamptz not null default now(),
  last_error          text,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, google_sub)
);

create index google_accounts_user_idx on public.google_accounts (user_id);

create trigger google_accounts_set_updated_at
  before update on public.google_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- google_credentials — jetons OAuth chiffrés
--
-- Table volontairement séparée : la RLS y est active et AUCUNE policy n'est
-- définie, donc ni `anon` ni `authenticated` ne peuvent lire une seule ligne,
-- même pour leur propre compte. Seul le rôle `service_role`, utilisé
-- exclusivement côté serveur, y accède. Les jetons sont de plus chiffrés en
-- AES-256-GCM par l'application avant d'être écrits : une fuite de la base ne
-- suffit donc pas à les exploiter.
-- ---------------------------------------------------------------------------

create table public.google_credentials (
  google_account_id  uuid primary key
                       references public.google_accounts (id) on delete cascade,
  access_token_enc   text,
  refresh_token_enc  text,
  token_expires_at   timestamptz,
  updated_at         timestamptz not null default now()
);

create trigger google_credentials_set_updated_at
  before update on public.google_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- google_calendars — calendriers exposés par un compte relié
-- ---------------------------------------------------------------------------

create table public.google_calendars (
  id                 uuid primary key default gen_random_uuid(),
  google_account_id  uuid not null references public.google_accounts (id) on delete cascade,
  household_id       uuid not null references public.households (id) on delete cascade,
  google_calendar_id text not null,
  summary            text,
  description        text,
  time_zone          text,
  background_color   text,
  -- Droit réel accordé par Google : owner / writer / reader / freeBusyReader.
  -- L'écriture n'est proposée que si ce droit l'autorise.
  access_role        text,
  is_primary         boolean not null default false,
  -- Choisi par l'utilisateur : afficher ce calendrier dans Tribu.
  is_selected        boolean not null default false,
  -- Choisi par l'utilisateur : calendrier cible des créations depuis Tribu.
  is_write_target    boolean not null default false,
  -- Ce que le foyer voit des événements importés.
  share_mode         public.google_share_mode not null default 'details',
  -- Jeton de synchronisation incrémentale renvoyé par Google.
  sync_token         text,
  last_sync_at       timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (google_account_id, google_calendar_id)
);

create index google_calendars_household_idx on public.google_calendars (household_id);
create index google_calendars_account_idx on public.google_calendars (google_account_id);
-- Un seul calendrier cible d'écriture par compte.
create unique index google_calendars_single_write_target
  on public.google_calendars (google_account_id)
  where is_write_target;

create trigger google_calendars_set_updated_at
  before update on public.google_calendars
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- events — le cœur du calendrier
-- ---------------------------------------------------------------------------

create table public.events (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,

  title                text not null check (length(btrim(title)) between 1 and 200),
  description          text,
  category             public.event_category not null default 'famille',
  kind                 public.event_kind not null default 'standard',

  -- Instants absolus : toute requête de plage se fait dessus, sans ambiguïté.
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  all_day              boolean not null default false,
  -- Fuseau de saisie, indispensable pour réafficher fidèlement un événement
  -- créé ailleurs et pour reconstruire les dates « journée entière ».
  timezone             text not null default 'Europe/Paris',

  location             text,
  address              text,

  responsible_member_id uuid references public.household_members (id) on delete set null,
  dropoff_member_id     uuid references public.household_members (id) on delete set null,
  pickup_member_id      uuid references public.household_members (id) on delete set null,

  -- Récurrence, calquée sur le modèle Google.
  -- `recurrence_rule` contient une RRULE RFC 5545 (sans le préfixe DTSTART).
  recurrence_rule      text,
  recurring_parent_id  uuid references public.events (id) on delete cascade,
  -- Date/heure d'origine de l'occurrence remplacée (exception de série).
  original_starts_at   timestamptz,
  -- Occurrence supprimée dans une série (équivalent d'un EXDATE).
  is_cancelled         boolean not null default false,

  origin               public.event_origin not null default 'tribu',
  -- Calendrier Google d'origine, pour afficher la provenance.
  google_calendar_ref  uuid references public.google_calendars (id) on delete set null,
  -- Événement importé en mode « disponibilité seule » : titre masqué.
  is_busy_only         boolean not null default false,

  -- Incrémenté à chaque modification locale : sert de garde anti-boucle avec
  -- Google (on ne renvoie que si la révision a bougé depuis le dernier envoi).
  revision             integer not null default 1,

  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint events_end_after_start check (ends_at >= starts_at),
  -- Une exception d'occurrence désigne toujours l'occurrence qu'elle remplace.
  constraint events_exception_shape check (
    (recurring_parent_id is null and original_starts_at is null)
    or (recurring_parent_id is not null and original_starts_at is not null)
  ),
  -- Une exception n'a pas de règle de récurrence propre.
  constraint events_exception_has_no_rrule check (
    recurring_parent_id is null or recurrence_rule is null
  )
);

create index events_household_range_idx
  on public.events (household_id, starts_at, ends_at);
create index events_household_recurring_idx
  on public.events (household_id)
  where recurrence_rule is not null;
create index events_parent_idx
  on public.events (recurring_parent_id)
  where recurring_parent_id is not null;
create index events_google_calendar_idx
  on public.events (google_calendar_ref)
  where google_calendar_ref is not null;

-- Une seule exception par occurrence remplacée.
create unique index events_unique_exception
  on public.events (recurring_parent_id, original_starts_at)
  where recurring_parent_id is not null;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- Incrémente la révision dès qu'un champ significatif change côté Tribu.
-- Les champs purement techniques de synchronisation en sont exclus, sans quoi
-- l'écriture du résultat d'un import déclencherait un nouvel export.
create or replace function public.bump_event_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.title, new.description, new.category, new.kind, new.starts_at,
      new.ends_at, new.all_day, new.timezone, new.location, new.address,
      new.recurrence_rule, new.is_cancelled)
     is distinct from
     (old.title, old.description, old.category, old.kind, old.starts_at,
      old.ends_at, old.all_day, old.timezone, old.location, old.address,
      old.recurrence_rule, old.is_cancelled)
  then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

create trigger events_bump_revision
  before update on public.events
  for each row execute function public.bump_event_revision();

-- ---------------------------------------------------------------------------
-- event_participants — adultes et enfants concernés
-- ---------------------------------------------------------------------------

create table public.event_participants (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  event_id      uuid not null references public.events (id) on delete cascade,
  member_id     uuid references public.household_members (id) on delete cascade,
  child_id      uuid references public.children (id) on delete cascade,
  constraint event_participants_one_target check (
    (member_id is not null)::int + (child_id is not null)::int = 1
  )
);

create index event_participants_event_idx on public.event_participants (event_id);
create index event_participants_household_idx on public.event_participants (household_id);
create unique index event_participants_unique_member
  on public.event_participants (event_id, member_id) where member_id is not null;
create unique index event_participants_unique_child
  on public.event_participants (event_id, child_id) where child_id is not null;

-- ---------------------------------------------------------------------------
-- event_reminders — rappels configurables
-- ---------------------------------------------------------------------------

create table public.event_reminders (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  event_id       uuid not null references public.events (id) on delete cascade,
  minutes_before integer not null check (minutes_before between 0 and 40320),
  created_at     timestamptz not null default now(),
  unique (event_id, minutes_before)
);

create index event_reminders_event_idx on public.event_reminders (event_id);

-- ---------------------------------------------------------------------------
-- trip_details — détails d'un déplacement
--
-- Départ et arrivée ont chacun leur lieu, leur instant et leur fuseau : un
-- Paris → New York s'affiche « 10:00 (Europe/Paris) → 12:30 (America/New_York) »
-- sans calcul faux.
-- ---------------------------------------------------------------------------

create table public.trip_details (
  event_id        uuid primary key references public.events (id) on delete cascade,
  household_id    uuid not null references public.households (id) on delete cascade,
  transport_mode  public.transport_mode not null default 'train',
  departure_place text,
  departure_at    timestamptz,
  departure_tz    text not null default 'Europe/Paris',
  arrival_place   text,
  arrival_at      timestamptz,
  arrival_tz      text not null default 'Europe/Paris',
  carrier_number  text,   -- numéro de train ou de vol
  booking_ref     text,   -- référence de réservation
  seat_info       text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint trip_details_order check (
    departure_at is null or arrival_at is null or arrival_at >= departure_at
  )
);

create index trip_details_household_idx on public.trip_details (household_id);

create trigger trip_details_set_updated_at
  before update on public.trip_details
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- attachments — pièces jointes privées
--
-- Le fichier vit dans le bucket privé `attachments`, sous un chemin dont le
-- premier segment est l'identifiant du foyer. Cette convention est ce que les
-- policies Storage (0007) contrôlent.
-- ---------------------------------------------------------------------------

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  event_id      uuid references public.events (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  uploaded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Garde-fou : le chemin doit commencer par l'identifiant du foyer.
  constraint attachments_path_scoped check (
    storage_path like household_id::text || '/%'
  )
);

create index attachments_event_idx on public.attachments (event_id);
create index attachments_household_idx on public.attachments (household_id);

-- ---------------------------------------------------------------------------
-- google_event_links — correspondance événement local ↔ événement Google
--
-- C'est la table qui empêche les doublons : une paire
-- (calendrier Google, identifiant d'événement Google) ne peut correspondre
-- qu'à un seul événement Tribu, et réciproquement.
-- ---------------------------------------------------------------------------

create table public.google_event_links (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households (id) on delete cascade,
  event_id                 uuid not null references public.events (id) on delete cascade,
  google_calendar_ref      uuid not null references public.google_calendars (id) on delete cascade,
  google_event_id          text not null,
  google_ical_uid          text,
  google_recurring_event_id text,
  etag                     text,
  remote_updated_at        timestamptz,
  -- Révision de l'événement local au moment du dernier envoi vers Google.
  -- Si `events.revision` n'a pas bougé, il n'y a rien à renvoyer : c'est la
  -- garde qui casse les boucles de synchronisation.
  pushed_revision          integer,
  last_synced_at           timestamptz,
  deleted_remotely         boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (google_calendar_ref, google_event_id),
  unique (event_id, google_calendar_ref)
);

create index google_event_links_event_idx on public.google_event_links (event_id);
create index google_event_links_household_idx on public.google_event_links (household_id);
create index google_event_links_ical_idx on public.google_event_links (google_ical_uid);

create trigger google_event_links_set_updated_at
  before update on public.google_event_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- google_sync_runs — journal des synchronisations, pour un état lisible
-- ---------------------------------------------------------------------------

create table public.google_sync_runs (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  google_calendar_ref uuid references public.google_calendars (id) on delete cascade,
  direction           text not null check (direction in ('import', 'export', 'complet')),
  status              text not null check (status in ('en_cours', 'succes', 'echec')),
  imported_count      integer not null default 0,
  updated_count       integer not null default 0,
  exported_count      integer not null default 0,
  deleted_count       integer not null default 0,
  error_message       text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create index google_sync_runs_household_idx
  on public.google_sync_runs (household_id, started_at desc);

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.google_accounts     enable row level security;
alter table public.google_credentials  enable row level security;
alter table public.google_calendars    enable row level security;
alter table public.events              enable row level security;
alter table public.event_participants  enable row level security;
alter table public.event_reminders     enable row level security;
alter table public.trip_details        enable row level security;
alter table public.attachments         enable row level security;
alter table public.google_event_links  enable row level security;
alter table public.google_sync_runs    enable row level security;

-- --- google_accounts : strictement personnel -------------------------------

create policy "google: lire mon compte"
  on public.google_accounts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "google: modifier mon compte"
  on public.google_accounts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "google: deconnecter mon compte"
  on public.google_accounts for delete to authenticated
  using (user_id = (select auth.uid()));

-- --- google_credentials : aucune policy, donc aucun accès client -----------
-- (RLS activée + zéro policy = table invisible pour anon et authenticated.)

-- --- google_calendars ------------------------------------------------------
-- Le foyer voit quels calendriers alimentent son agenda ; seul le
-- propriétaire du compte Google peut les configurer.

create policy "calendriers google: lire dans mon foyer"
  on public.google_calendars for select to authenticated
  using (public.is_household_member(household_id));

create policy "calendriers google: configurer les miens"
  on public.google_calendars for update to authenticated
  using (
    exists (
      select 1 from public.google_accounts ga
      where ga.id = google_calendars.google_account_id
        and ga.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.google_accounts ga
      where ga.id = google_calendars.google_account_id
        and ga.user_id = (select auth.uid())
    )
  );

create policy "calendriers google: retirer les miens"
  on public.google_calendars for delete to authenticated
  using (
    exists (
      select 1 from public.google_accounts ga
      where ga.id = google_calendars.google_account_id
        and ga.user_id = (select auth.uid())
    )
  );

-- --- events ----------------------------------------------------------------

create policy "evenements: lire"
  on public.events for select to authenticated
  using (public.is_household_member(household_id));

create policy "evenements: ajouter"
  on public.events for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "evenements: modifier"
  on public.events for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "evenements: supprimer"
  on public.events for delete to authenticated
  using (public.is_household_member(household_id));

-- --- event_participants ----------------------------------------------------

create policy "participants: lire"
  on public.event_participants for select to authenticated
  using (public.is_household_member(household_id));

create policy "participants: ajouter"
  on public.event_participants for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "participants: modifier"
  on public.event_participants for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "participants: supprimer"
  on public.event_participants for delete to authenticated
  using (public.is_household_member(household_id));

-- --- event_reminders -------------------------------------------------------

create policy "rappels: lire"
  on public.event_reminders for select to authenticated
  using (public.is_household_member(household_id));

create policy "rappels: ajouter"
  on public.event_reminders for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "rappels: modifier"
  on public.event_reminders for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "rappels: supprimer"
  on public.event_reminders for delete to authenticated
  using (public.is_household_member(household_id));

-- --- trip_details ----------------------------------------------------------

create policy "deplacements: lire"
  on public.trip_details for select to authenticated
  using (public.is_household_member(household_id));

create policy "deplacements: ajouter"
  on public.trip_details for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "deplacements: modifier"
  on public.trip_details for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "deplacements: supprimer"
  on public.trip_details for delete to authenticated
  using (public.is_household_member(household_id));

-- --- attachments -----------------------------------------------------------

create policy "pieces jointes: lire"
  on public.attachments for select to authenticated
  using (public.is_household_member(household_id));

create policy "pieces jointes: ajouter"
  on public.attachments for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and uploaded_by = (select auth.uid())
  );

create policy "pieces jointes: supprimer"
  on public.attachments for delete to authenticated
  using (public.is_household_member(household_id));

-- --- google_event_links ----------------------------------------------------
-- Lisible par le foyer (affichage de la provenance) ; l'écriture est réservée
-- au serveur de synchronisation, qui utilise `service_role`.

create policy "liens google: lire"
  on public.google_event_links for select to authenticated
  using (public.is_household_member(household_id));

-- --- google_sync_runs ------------------------------------------------------

create policy "journal google: lire"
  on public.google_sync_runs for select to authenticated
  using (public.is_household_member(household_id));
