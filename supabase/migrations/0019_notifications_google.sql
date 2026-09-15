-- ---------------------------------------------------------------------------
-- 0019 — Canaux de notification Google Agenda
--
-- POURQUOI
-- --------
-- Jusqu'ici, la synchronisation Google ne partait que d'un clic sur le bouton
-- « Synchroniser ». Tant que personne n'appuyait, un rendez-vous ajouté depuis
-- Google Agenda n'existait pas dans MyFamily, et un événement créé dans
-- MyFamily ne remontait pas chez Google. C'est la question qui a fini par être
-- posée, et elle était légitime : un agenda familial qui ne se met à jour que
-- sur commande n'est pas un agenda partagé, c'est un import manuel.
--
-- L'automatisation repose sur trois déclencheurs complémentaires. Deux ne
-- demandent rien à la base : un cron Vercel qui repasse régulièrement, et une
-- synchronisation opportuniste à l'ouverture de l'écran Calendrier. Le
-- troisième, lui, a besoin d'un état durable : les **notifications push** de
-- Google (`events.watch`), par lesquelles Google prévient MyFamily qu'un
-- calendrier a bougé, au lieu d'attendre qu'on le lui demande.
--
-- Un canal de notification n'est pas une donnée jetable : il faut le
-- retrouver pour l'arrêter (`channels.stop` exige l'identifiant de canal ET
-- l'identifiant de ressource), le renouveler avant expiration, et vérifier
-- l'authenticité de chaque notification reçue. D'où cette table.
--
-- CE QU'ON N'A PAS MIS, ET POURQUOI
-- ---------------------------------
-- Le jeton de vérification n'est **pas** stocké en clair. Google le renvoie
-- dans l'en-tête `X-Goog-Channel-Token` de chaque notification ; seul son
-- condensat SHA-256 est gardé ici, exactement comme pour les invitations. Une
-- lecture de la base ne permet donc pas de fabriquer une fausse notification.
--
-- Pas non plus de colonne d'identifiant de compte : un canal appartient à un
-- calendrier, qui appartient déjà à un compte Google et à un foyer. Ajouter
-- l'identifiant ici en ferait une troisième copie à tenir à jour, et une de
-- plus à effacer à la suppression d'un compte.
-- ---------------------------------------------------------------------------

create table public.google_watch_channels (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,

  -- Un seul canal par calendrier : en ouvrir deux ferait arriver chaque
  -- changement en double, sans rien apporter.
  google_calendar_ref uuid not null unique
                        references public.google_calendars (id) on delete cascade,

  -- Identifiant que MyFamily choisit et que Google renvoie dans
  -- `X-Goog-Channel-ID`. C'est la clé de lecture d'une notification entrante.
  channel_id          text not null unique,
  -- Identifiant que Google attribue à la ressource observée. Indispensable
  -- pour arrêter le canal : `channels.stop` refuse sans lui.
  resource_id         text not null,

  -- Condensat du jeton de vérification. Le jeton lui-même n'existe qu'en
  -- mémoire, le temps de l'inscription, et dans les en-têtes que Google nous
  -- renvoie.
  token_hash          text not null,

  -- Expiration annoncée par Google. Les canaux Agenda durent quelques jours :
  -- le cron les renouvelle avant l'échéance.
  expires_at          timestamptz,

  -- Dernière notification effectivement reçue sur ce canal. Sans cette date,
  -- on ne saurait pas distinguer « Google ne nous a rien envoyé parce que
  -- rien n'a bougé » de « le canal est mort sans le dire ».
  last_notified_at    timestamptz,
  last_error          text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Sans cet index, supprimer un foyer parcourt toute la table.
create index google_watch_channels_household_idx
  on public.google_watch_channels (household_id);

-- Le cron cherche les canaux qui approchent de leur expiration.
create index google_watch_channels_expiry_idx
  on public.google_watch_channels (expires_at);

create trigger google_watch_channels_set_updated_at
  before update on public.google_watch_channels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Lecture seule pour les membres du foyer : l'écran Google Agenda affiche si
-- les notifications sont actives et jusqu'à quand, et c'est tout ce dont
-- l'interface a besoin. Rien de secret n'y transite — le jeton est haché, et
-- connaître un identifiant de canal ne permet aucune action sans les jetons
-- OAuth, qui vivent dans `google_credentials`, hors de portée de tous.
--
-- Aucune politique d'écriture : inscrire, renouveler ou arrêter un canal est
-- une opération serveur, faite avec le rôle `service_role` juste après un
-- contrôle d'appartenance explicite. Un membre du foyer n'a donc aucun moyen
-- d'écrire ici, même pour son propre calendrier.
-- ---------------------------------------------------------------------------

alter table public.google_watch_channels enable row level security;

create policy "canaux google: lire"
  on public.google_watch_channels for select to authenticated
  using (public.is_household_member(household_id));
