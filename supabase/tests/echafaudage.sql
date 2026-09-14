-- ===========================================================================
-- Échafaudage — ce que Supabase fournit d'office, reconstitué
-- ===========================================================================
--
-- À QUOI CE FICHIER SERT, ET À QUOI IL NE SERT PAS
-- ------------------------------------------------
-- Les migrations de ce dépôt s'appuient sur ce qu'un projet Supabase apporte
-- sans qu'on l'écrive : les rôles `anon`, `authenticated` et `service_role`,
-- les schémas `auth` et `storage`, la fonction `auth.jwt()`, la publication
-- `supabase_realtime`, pgcrypto dans `extensions`. Sur un PostgreSQL nu, rien
-- de tout cela n'existe et la première migration s'arrête aussitôt.
--
-- Ce fichier comble ce manque, et **uniquement** pour pouvoir rejouer les
-- migrations et `isolation.sql` sans projet Supabase : en intégration
-- continue, ou en local quand on veut vérifier qu'une migration s'applique
-- depuis une base vide.
--
-- Ce n'est PAS une imitation fidèle de Supabase. `auth.users` n'a ici que les
-- colonnes dont les tests se servent, GoTrue et PostgREST sont absents, et les
-- droits par défaut sont approchés. Ce qu'il permet de vérifier :
--   * une migration s'applique-t-elle depuis zéro, dans l'ordre ?
--   * les politiques RLS tiennent-elles quand on se fait passer pour un
--     utilisateur connecté ?
-- Ce qu'il ne remplace pas : les conseillers Supabase et la vraie pile, qui
-- restent à jouer sur le projet (voir `docs/TESTS.md`).
--
-- Pour une pile complète et fidèle, préférer `npx supabase start`.
-- ===========================================================================

-- ÉCHAFAUDAGE — ce que Supabase fournit d'office, reconstitué

do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key,
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  created_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  _parts := string_to_array(name, '/');
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create publication supabase_realtime;
