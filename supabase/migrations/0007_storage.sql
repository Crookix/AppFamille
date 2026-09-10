-- ===========================================================================
-- Tribu — 0007 — Stockage privé des pièces jointes et des photos
--
-- Deux buckets PRIVÉS. Aucun fichier n'est accessible par URL publique : la
-- lecture passe par une URL signée à durée de vie courte, délivrée seulement
-- après vérification de l'appartenance au foyer.
--
-- Convention de chemin : <household_id>/<reste-du-chemin>
-- C'est le premier segment du chemin qui porte le contrôle d'accès.
-- ===========================================================================

-- Cast tolérant : un chemin mal formé donne NULL plutôt qu'une erreur, ce qui
-- fait échouer la policy proprement au lieu d'interrompre la requête.
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = pg_temp
as $$
begin
  return p_text::uuid;
exception
  when others then
    return null;
end;
$$;

grant execute on function public.safe_uuid(text) to authenticated;

-- Identifiant de foyer porté par un chemin de stockage.
create or replace function public.storage_household_id(p_name text)
returns uuid
language sql
immutable
set search_path = public, storage, pg_temp
as $$
  select public.safe_uuid((storage.foldername(p_name))[1]);
$$;

grant execute on function public.storage_household_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('attachments', 'attachments', false, 26214400),  -- 25 Mo par fichier
  ('avatars',     'avatars',     false, 5242880)    -- 5 Mo par image
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Policies — pièces jointes
-- ---------------------------------------------------------------------------

create policy "stockage pj: lire si membre du foyer"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_household_member(public.storage_household_id(name))
  );

create policy "stockage pj: deposer si membre du foyer"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_household_member(public.storage_household_id(name))
    and owner_id = (select auth.uid())::text
  );

create policy "stockage pj: remplacer si membre du foyer"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_household_member(public.storage_household_id(name))
  )
  with check (
    bucket_id = 'attachments'
    and public.is_household_member(public.storage_household_id(name))
  );

create policy "stockage pj: supprimer si membre du foyer"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_household_member(public.storage_household_id(name))
  );

-- ---------------------------------------------------------------------------
-- Policies — photos (enfants, avatars des adultes)
-- ---------------------------------------------------------------------------

create policy "stockage photos: lire si membre du foyer"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_household_member(public.storage_household_id(name))
  );

create policy "stockage photos: deposer si membre du foyer"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.is_household_member(public.storage_household_id(name))
    and owner_id = (select auth.uid())::text
  );

create policy "stockage photos: remplacer si membre du foyer"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_household_member(public.storage_household_id(name))
  )
  with check (
    bucket_id = 'avatars'
    and public.is_household_member(public.storage_household_id(name))
  );

create policy "stockage photos: supprimer si membre du foyer"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_household_member(public.storage_household_id(name))
  );
